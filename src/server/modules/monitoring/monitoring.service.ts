import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { getTriggerRuntimeConfig, triggerProductDemandScan } from "@/server/providers/trigger/client";
import { attachTriggerRun, claimProductDemandScanDispatch, executeProductDemandScan, markProductDemandScanDispatchNotApplicable, prepareProductDemandScan } from "@/server/modules/operations/product-demand-scan.service";
import { scheduledScanIdempotencyKey } from "@/server/modules/operations/product-demand-scan.identity";
import { isActiveProduct } from "@/server/modules/products/product-lifecycle";
import { resolveMonitoringPolicy, type MonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";
import { ensureMonitoringSchedulesForActiveProducts, nextMonitoringCycleAt, nextMonitoringDeepRefreshAt } from "./monitoring.schedule";
import {
  claimMonitoringSchedule,
  deferMonitoringSchedule,
  disableMonitoringSchedule,
  getMonitoringSchedule,
  listDueMonitoringSchedules,
  recordMonitoringScheduleDispatched,
  recordMonitoringScheduleFailure,
} from "./monitoring.repository";

type Client = SupabaseClient<Database>;

async function monitoringOwner(client: Client, workspaceId: string): Promise<string | null> {
  const { data, error } = await client.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active").in("role", ["owner", "admin"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "Monitoring workspace membership could not be loaded.", 500, { providerMessage: error.message });
  return data?.user_id ?? null;
}

async function dispatchOneMonitoringSchedule(client: Client, schedule: Awaited<ReturnType<typeof getMonitoringSchedule>>, policy: MonitoringPolicy, now: string): Promise<{ status: "dispatched" | "skipped" | "failed"; jobRunId?: string }> {
  if (!schedule) return { status: "skipped" };
  const product = await client.from("products").select("status").eq("workspace_id", schedule.workspace_id).eq("id", schedule.product_id).maybeSingle();
  if (product.error) throw new AppError("INTERNAL_ERROR", "Monitored product could not be verified.", 500, { providerMessage: product.error.message });
  if (!product.data || !isActiveProduct(product.data)) {
    await disableMonitoringSchedule(client, schedule.workspace_id, schedule.product_id);
    return { status: "skipped" };
  }
  const deep = schedule.next_deep_refresh_at !== null && schedule.next_deep_refresh_at <= now && policy.deepRefreshesPerWeek > 0;
  const cycle = schedule.next_cycle_at !== null && schedule.next_cycle_at <= now && policy.intelligenceCyclesPerDay > 0;
  const leaseKind = deep ? "deep_refresh" : cycle ? "intelligence_cycle" : null;
  if (!leaseKind) return { status: "skipped" };

  const claimed = await claimMonitoringSchedule(client, schedule.id, randomUUID(), leaseKind, now);
  if (!claimed) return { status: "skipped" };
  const today = now.slice(0, 10);
  if (policy.xDailyBudgetUsd > 0 && claimed.x_cost_day === today && Number(claimed.x_cost_day_usd) >= policy.xDailyBudgetUsd) {
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await deferMonitoringSchedule(client, claimed, {
      nextCycleAt: leaseKind === "intelligence_cycle" ? tomorrow.toISOString() : claimed.next_cycle_at,
      nextDeepRefreshAt: leaseKind === "deep_refresh" ? tomorrow.toISOString() : claimed.next_deep_refresh_at,
    });
    return { status: "skipped" };
  }
  const ownerId = await monitoringOwner(client, schedule.workspace_id);
  if (!ownerId) {
    await recordMonitoringScheduleFailure(client, claimed, "No active workspace member.", now, "MONITORING_OWNER_MISSING");
    return { status: "failed" };
  }

  const slot = leaseKind === "deep_refresh" ? claimed.next_deep_refresh_at ?? now : claimed.next_cycle_at ?? now;
  const input = {
    workspaceId: claimed.workspace_id,
    productId: claimed.product_id,
    requestedByUserId: ownerId,
    scanMode: leaseKind === "deep_refresh" ? "deep_refresh" : "monitoring",
    idempotencyKey: scheduledScanIdempotencyKey(claimed.workspace_id, claimed.product_id, leaseKind === "deep_refresh" ? "deep_refresh" : "monitoring", slot),
    forceRebuild: false,
    monitoringScheduleId: claimed.id,
    monitoringLeaseToken: claimed.lease_token ?? undefined,
  } as const;

  try {
    const prepared = await prepareProductDemandScan(input);
    if (prepared.shouldTrigger && prepared.job.status === "pending") {
      const claimedJob = await claimProductDemandScanDispatch(prepared.job.id);
      if (!claimedJob) return { status: "skipped", jobRunId: prepared.job.id };
    }
    if (prepared.shouldTrigger) {
      const triggerConfig = getTriggerRuntimeConfig();
      if (triggerConfig.executionMode === "direct") {
        await markProductDemandScanDispatchNotApplicable(prepared.job.id);
        await executeProductDemandScan(prepared.input);
      } else {
        if (!triggerConfig.triggerSecretPresent) throw new AppError("INTERNAL_ERROR", "Background scan processing is not configured.");
        const handle = await triggerProductDemandScan(prepared.input, {
          idempotencyKey: prepared.input.idempotencyKey,
          concurrencyKey: `product:${prepared.input.workspaceId}:${prepared.input.productId}`,
        });
        await attachTriggerRun(prepared.job.id, handle.id);
      }
    }
    const nextCycle = leaseKind === "intelligence_cycle" ? nextMonitoringCycleAt(now, policy, claimed.product_id) : claimed.next_cycle_at;
    const nextDeep = leaseKind === "deep_refresh" ? nextMonitoringDeepRefreshAt(now, policy, claimed.product_id) : claimed.next_deep_refresh_at;
    await recordMonitoringScheduleDispatched(client, claimed, { now, nextCycleAt: nextCycle, nextDeepRefreshAt: nextDeep, jobRunId: prepared.job.id });
    return { status: "dispatched", jobRunId: prepared.job.id };
  } catch (error) {
    await recordMonitoringScheduleFailure(
      client,
      claimed,
      error instanceof Error ? error.message : "Monitoring dispatch failed.",
      now,
      error instanceof AppError ? error.code : "MONITORING_DISPATCH_FAILED",
    );
    if (error instanceof AppError && error.code === "INTERNAL_ERROR") return { status: "failed" };
    throw error;
  }
}

export async function dispatchDueMonitoringSchedules(input: { now?: string; limit?: number } = {}): Promise<{ ensured: number; scanned: number; dispatched: number; skipped: number; failed: number }> {
  const now = input.now ?? new Date().toISOString();
  const client = createSupabaseServiceClient();
  const ensured = await ensureMonitoringSchedulesForActiveProducts(client, now);
  const due = await listDueMonitoringSchedules(client, now, input.limit ?? 100);
  const policyCache = new Map<string, MonitoringPolicy>();
  let dispatched = 0;
  let skipped = 0;
  let failed = 0;
  for (const schedule of due) {
    const policy = policyCache.get(schedule.workspace_id) ?? await resolveMonitoringPolicy(client, schedule.workspace_id);
    policyCache.set(schedule.workspace_id, policy);
    if (!policy.monitoringEnabled) {
      await disableMonitoringSchedule(client, schedule.workspace_id, schedule.product_id);
      skipped += 1;
      continue;
    }
    const result = await dispatchOneMonitoringSchedule(client, schedule, policy, now);
    if (result.status === "dispatched") dispatched += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }
  return { ensured, scanned: due.length, dispatched, skipped, failed };
}
