import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { jsonValueSchema, type Json, type MonitoringScheduleRow } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";
import type { ScanMode } from "@/server/modules/operations/product-demand-scan.schemas";

type Client = SupabaseClient<Database>;

function providerError(message: string, providerMessage?: string): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, providerMessage ? { providerMessage } : undefined);
}

function json(value: unknown): Json {
  return jsonValueSchema.parse(value);
}

function retryAt(now: string, consecutiveFailures: number): string {
  const delay = Math.min(60 * 60_000, Math.max(10 * 60_000, 2 ** Math.min(consecutiveFailures, 5) * 60_000));
  return new Date(Date.parse(now) + delay).toISOString();
}

function isDeepRefresh(mode: ScanMode | undefined): boolean {
  return mode === "deep" || mode === "deep_refresh";
}

export async function getMonitoringSchedule(client: Client, workspaceId: string, productId: string): Promise<MonitoringScheduleRow | null> {
  const { data, error } = await client.from("monitoring_schedules").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).maybeSingle();
  if (error) throw providerError("Monitoring schedule could not be loaded.", error.message);
  return data;
}

export async function upsertMonitoringSchedule(
  client: Client,
  input: {
    workspaceId: string;
    productId: string;
    enabled: boolean;
    policyVersion: string;
    policySnapshot: unknown;
    nextCycleAt: string | null;
    nextDeepRefreshAt: string | null;
  },
): Promise<MonitoringScheduleRow> {
  const { data, error } = await client.from("monitoring_schedules").upsert({
    workspace_id: input.workspaceId,
    product_id: input.productId,
    enabled: input.enabled,
    policy_version: input.policyVersion,
    policy_snapshot: json(input.policySnapshot),
    next_cycle_at: input.nextCycleAt,
    next_deep_refresh_at: input.nextDeepRefreshAt,
  }, { onConflict: "workspace_id,product_id" }).select("*").single();
  if (error || !data) throw providerError("Monitoring schedule could not be saved.", error?.message);
  return data;
}

export async function updateMonitoringSchedule(
  client: Client,
  scheduleId: string,
  patch: Database["public"]["Tables"]["monitoring_schedules"]["Update"],
  leaseToken?: string,
): Promise<MonitoringScheduleRow | null> {
  let query = client.from("monitoring_schedules").update(patch).eq("id", scheduleId);
  if (leaseToken !== undefined) query = query.eq("lease_token", leaseToken);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw providerError("Monitoring schedule could not be updated.", error.message);
  return data;
}

export async function disableMonitoringSchedule(client: Client, workspaceId: string, productId: string): Promise<void> {
  const { error } = await client.from("monitoring_schedules").update({ enabled: false, current_status: "paused", next_cycle_at: null, next_deep_refresh_at: null, lease_token: null, lease_kind: null, lease_expires_at: null }).eq("workspace_id", workspaceId).eq("product_id", productId);
  if (error) throw providerError("Monitoring schedule could not be disabled.", error.message);
}

export async function listDueMonitoringSchedules(client: Client, now: string, limit: number): Promise<MonitoringScheduleRow[]> {
  const { data, error } = await client.from("monitoring_schedules").select("*").eq("enabled", true).or(`next_cycle_at.lte.${now},next_deep_refresh_at.lte.${now}`).order("next_cycle_at", { ascending: true, nullsFirst: false }).limit(limit);
  if (error) throw providerError("Due monitoring schedules could not be loaded.", error.message);
  return data ?? [];
}

export async function claimMonitoringSchedule(client: Client, scheduleId: string, leaseToken: string, leaseKind: "intelligence_cycle" | "deep_refresh", now: string): Promise<MonitoringScheduleRow | null> {
  const args: Database["public"]["Functions"]["claim_monitoring_schedule"]["Args"] = {
    p_schedule_id: scheduleId,
    p_lease_token: leaseToken,
    p_lease_kind: leaseKind,
    p_now: now,
    p_lease_seconds: 900,
  };
  const { data, error } = await client.rpc("claim_monitoring_schedule", args);
  if (error) throw providerError("Monitoring schedule could not be claimed.", error.message);
  return data;
}

export async function recordMonitoringScheduleFailure(client: Client, schedule: MonitoringScheduleRow, message: string, now: string, errorCode = "MONITORING_DISPATCH_FAILED"): Promise<void> {
  const scheduledRetryAt = retryAt(now, schedule.consecutive_failures);
  const leaseKind = schedule.lease_kind;
  await updateMonitoringSchedule(client, schedule.id, {
    current_status: "failed",
    last_failure_at: now,
    last_error_at: now,
    last_error_code: errorCode,
    consecutive_failures: schedule.consecutive_failures + 1,
    lease_token: null,
    lease_kind: null,
    lease_expires_at: null,
    next_cycle_at: leaseKind === "intelligence_cycle" ? scheduledRetryAt : schedule.next_cycle_at,
    next_deep_refresh_at: leaseKind === "deep_refresh" ? scheduledRetryAt : schedule.next_deep_refresh_at,
  }, schedule.lease_token ?? undefined);
  void message;
}

export async function deferMonitoringSchedule(
  client: Client,
  schedule: MonitoringScheduleRow,
  input: { nextCycleAt: string | null; nextDeepRefreshAt: string | null },
): Promise<void> {
  await updateMonitoringSchedule(client, schedule.id, {
    next_cycle_at: input.nextCycleAt,
    next_deep_refresh_at: input.nextDeepRefreshAt,
    lease_token: null,
    lease_kind: null,
    lease_expires_at: null,
  }, schedule.lease_token ?? undefined);
}

export async function recordMonitoringScheduleSuccess(
  client: Client,
  schedule: MonitoringScheduleRow,
  input: { now: string; nextCycleAt: string | null; nextDeepRefreshAt: string | null; jobRunId: string; xCostUsd?: number },
): Promise<void> {
  const today = input.now.slice(0, 10);
  const sameDay = schedule.x_cost_day === today;
  const cost = sameDay ? Number(schedule.x_cost_day_usd) + (input.xCostUsd ?? 0) : (input.xCostUsd ?? 0);
  await updateMonitoringSchedule(client, schedule.id, {
    last_success_at: input.now,
    consecutive_failures: 0,
    last_cycle_at: schedule.lease_kind === "intelligence_cycle" ? input.now : schedule.last_cycle_at,
    last_deep_refresh_at: schedule.lease_kind === "deep_refresh" ? input.now : schedule.last_deep_refresh_at,
    next_cycle_at: input.nextCycleAt,
    next_deep_refresh_at: input.nextDeepRefreshAt,
    last_job_run_id: input.jobRunId,
    x_cost_day: today,
    x_cost_day_usd: cost,
    lease_token: null,
    lease_kind: null,
    lease_expires_at: null,
  }, schedule.lease_token ?? undefined);
}

export async function recordMonitoringScheduleDispatched(
  client: Client,
  schedule: MonitoringScheduleRow,
  input: { now: string; nextCycleAt: string | null; nextDeepRefreshAt: string | null; jobRunId: string },
): Promise<void> {
  await updateMonitoringSchedule(client, schedule.id, {
    next_cycle_at: input.nextCycleAt,
    next_deep_refresh_at: input.nextDeepRefreshAt,
    last_job_run_id: input.jobRunId,
    lease_token: null,
    lease_kind: null,
    lease_expires_at: null,
  }, schedule.lease_token ?? undefined);
}

export async function recordMonitoringScanOutcome(
  client: Client,
  input: {
    scheduleId: string;
    jobRunId: string;
    succeeded: boolean;
    message?: string;
    errorCode?: string;
    xCostUsd?: number;
    now?: string;
    scanMode?: ScanMode;
    newCandidateCount?: number;
    newSignalCount?: number;
    intelligenceUpdated?: boolean;
  },
): Promise<void> {
  const { data: schedule, error } = await client.from("monitoring_schedules").select("*").eq("id", input.scheduleId).maybeSingle();
  if (error) throw providerError("Monitoring schedule outcome could not be loaded.", error.message);
  if (!schedule || schedule.last_job_run_id !== input.jobRunId) return;
  const now = input.now ?? new Date().toISOString();
  const today = now.slice(0, 10);
  const sameDay = schedule.x_cost_day === today;
  const cost = sameDay ? Number(schedule.x_cost_day_usd) + (input.xCostUsd ?? 0) : (input.xCostUsd ?? 0);
  const retry = retryAt(now, schedule.consecutive_failures);
  const deep = isDeepRefresh(input.scanMode);
  const patch: Database["public"]["Tables"]["monitoring_schedules"]["Update"] = {
    current_status: input.succeeded ? "completed" : "failed",
    ...(input.succeeded
      ? {
          last_success_at: now,
          consecutive_failures: 0,
          last_error_code: null,
          last_error_at: null,
          last_new_candidate_count: input.newCandidateCount ?? 0,
          last_new_signal_count: input.newSignalCount ?? 0,
          ...(input.intelligenceUpdated ? { last_intelligence_update_at: now } : {}),
        }
      : {
          last_failure_at: now,
          last_error_code: input.errorCode ?? "MONITORING_SCAN_FAILED",
          last_error_at: now,
          consecutive_failures: schedule.consecutive_failures + 1,
          ...(deep ? { next_deep_refresh_at: retry } : { next_cycle_at: retry }),
        }),
    ...(input.xCostUsd === undefined ? {} : { x_cost_day: today, x_cost_day_usd: cost }),
  };
  await updateMonitoringSchedule(client, schedule.id, patch);
  void input.message;
}
