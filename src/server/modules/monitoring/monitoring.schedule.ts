import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import { jsonValueSchema, type Json, type MonitoringScheduleRow } from "../../db/database.helpers";
import { AppError } from "../../lib/errors";
import { isActiveProduct } from "../products/product-lifecycle";
import { resolveMonitoringPolicy, monitoringPolicySnapshot, type MonitoringPolicy } from "../entitlements/monitoring-policy";
import { resolveWorkspaceCapabilities } from "../entitlements/plan-capabilities";

type Client = SupabaseClient<Database>;
const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;

function deterministicJitterMinutes(productId: string, maxMinutes = 15): number {
  let hash = 0;
  for (const character of productId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % (maxMinutes + 1);
}

function after(now: string, minutes: number, jitterMinutes: number): string {
  return new Date(Date.parse(now) + Math.max(0, minutes) * MINUTE + jitterMinutes * MINUTE).toISOString();
}

export function nextMonitoringCycleAt(now: string, policy: MonitoringPolicy, productId: string): string | null {
  return policy.monitoringEnabled && policy.intelligenceCyclesPerDay > 0 && policy.intelligenceCycleIntervalMinutes > 0
    ? after(now, policy.intelligenceCycleIntervalMinutes, deterministicJitterMinutes(productId))
    : null;
}

export function nextMonitoringDeepRefreshAt(now: string, policy: MonitoringPolicy, productId: string): string | null {
  if (!policy.monitoringEnabled || policy.deepRefreshesPerWeek <= 0) return null;
  const intervalMinutes = Math.max(24 * 60, Math.floor(WEEK / MINUTE / policy.deepRefreshesPerWeek));
  return after(now, intervalMinutes, deterministicJitterMinutes(`${productId}:deep`));
}

function snapshotChanged(existing: unknown, next: unknown): boolean {
  return JSON.stringify(existing ?? {}) !== JSON.stringify(next ?? {});
}

async function getSchedule(client: Client, workspaceId: string, productId: string): Promise<MonitoringScheduleRow | null> {
  const { data, error } = await client.from("monitoring_schedules").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", "Monitoring schedule could not be loaded.", 500, { providerMessage: error.message });
  return data;
}

async function upsertSchedule(client: Client, input: {
  workspaceId: string;
  productId: string;
  enabled: boolean;
  policyVersion: string;
  policySnapshot: Json;
  currentStatus: string;
  nextCycleAt: string | null;
  nextDeepRefreshAt: string | null;
}): Promise<void> {
  const { error } = await client.from("monitoring_schedules").upsert({
    workspace_id: input.workspaceId,
    product_id: input.productId,
    enabled: input.enabled,
    current_status: input.currentStatus,
    policy_version: input.policyVersion,
    policy_snapshot: jsonValueSchema.parse(input.policySnapshot),
    next_cycle_at: input.nextCycleAt,
    next_deep_refresh_at: input.nextDeepRefreshAt,
  }, { onConflict: "workspace_id,product_id" });
  if (error) throw new AppError("INTERNAL_ERROR", "Monitoring schedule could not be saved.", 500, { providerMessage: error.message });
}

export async function ensureMonitoringScheduleForProduct(client: Client, workspaceId: string, productId: string, now = new Date().toISOString(), options: { eligibleForPlan?: boolean } = {}): Promise<void> {
  const policy = await resolveMonitoringPolicy(client, workspaceId);
  const existing = await getSchedule(client, workspaceId, productId);
  const snapshot = monitoringPolicySnapshot(policy);
  const enabled = policy.monitoringEnabled && options.eligibleForPlan !== false;
  const policyChanged = existing ? snapshotChanged(existing.policy_snapshot, snapshot) : false;
  const currentStatus = !enabled
    ? "paused"
    : existing?.current_status === "paused" || policyChanged
      ? "idle"
      : existing?.current_status ?? "idle";
  await upsertSchedule(client, {
    workspaceId,
    productId,
    enabled,
    policyVersion: policy.version,
    policySnapshot: snapshot,
    currentStatus,
    nextCycleAt: enabled
      ? policyChanged ? nextMonitoringCycleAt(now, policy, productId) : existing?.next_cycle_at ?? nextMonitoringCycleAt(now, policy, productId)
      : null,
    nextDeepRefreshAt: enabled
      ? policyChanged ? nextMonitoringDeepRefreshAt(now, policy, productId) : existing?.next_deep_refresh_at ?? nextMonitoringDeepRefreshAt(now, policy, productId)
      : null,
  });
}

export async function ensureMonitoringSchedulesForActiveProducts(client: Client, now: string): Promise<number> {
  let ensured = 0;
  const pageSize = 500;
  const capabilitiesByWorkspace = new Map<string, Awaited<ReturnType<typeof resolveWorkspaceCapabilities>>>();
  const monitoredCountByWorkspace = new Map<string, number>();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("products").select("workspace_id,id,status,created_at").eq("status", "active").order("workspace_id", { ascending: true }).order("created_at", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new AppError("INTERNAL_ERROR", "Active monitoring products could not be loaded.", 500, { providerMessage: error.message });
    const productsByWorkspace = new Map<string, Array<{ workspace_id: string; id: string; status: string; created_at: string }>>();
    for (const product of data ?? []) {
      if (!isActiveProduct(product)) continue;
      const products = productsByWorkspace.get(product.workspace_id) ?? [];
      products.push(product);
      productsByWorkspace.set(product.workspace_id, products);
    }
    for (const [workspaceId, products] of productsByWorkspace) {
      const capabilities = capabilitiesByWorkspace.get(workspaceId) ?? await resolveWorkspaceCapabilities(client, workspaceId);
      capabilitiesByWorkspace.set(workspaceId, capabilities);
      let monitoredCount = monitoredCountByWorkspace.get(workspaceId) ?? 0;
      for (const product of products) {
        const eligibleForPlan = monitoredCount < capabilities.products.maxProducts;
        if (eligibleForPlan) monitoredCount += 1;
        await ensureMonitoringScheduleForProduct(client, product.workspace_id, product.id, now, { eligibleForPlan });
        ensured += 1;
      }
      monitoredCountByWorkspace.set(workspaceId, monitoredCount);
    }
    if ((data ?? []).length < pageSize) break;
  }
  return ensured;
}
