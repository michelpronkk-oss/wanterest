import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import { listWorkspaceEntitlements } from "./entitlement.repository";
import { MONITORING_POLICY_VERSION, type MonitoringPolicy } from "./monitoring-policy.contract";

export { MONITORING_POLICY_VERSION, monitoringPolicySnapshot, demandDriftWindowAllowed } from "./monitoring-policy.contract";
export type { MonitoringPolicy } from "./monitoring-policy.contract";

type Client = SupabaseClient<Database>;

const integerKeys = {
  intelligenceCyclesPerDay: "intelligence_cycles_per_day",
  intelligenceCycleIntervalMinutes: "intelligence_cycle_interval_minutes",
  deepRefreshesPerWeek: "deep_refreshes_per_week",
  manualRefreshCooldownMinutes: "manual_refresh_cooldown_minutes",
  intelligenceCycleMaxSources: "intelligence_cycle_max_sources",
  intelligenceCycleQueryBudget: "intelligence_cycle_query_budget",
  intelligenceCycleCandidateBudget: "intelligence_cycle_candidate_budget",
  deepRefreshMaxSources: "deep_refresh_max_sources",
  deepRefreshQueryBudget: "deep_refresh_query_budget",
  deepRefreshCandidateBudget: "deep_refresh_candidate_budget",
  xMaxRequestsPerCycle: "x_max_requests_per_cycle",
  xMaxBillablePostsPerCycle: "x_max_billable_posts_per_cycle",
  xMaxRequestsPerDeepRefresh: "x_max_requests_per_deep_refresh",
  xMaxBillablePostsPerDeepRefresh: "x_max_billable_posts_per_deep_refresh",
  demandDriftDays: "demand_drift_days",
} as const;

const booleanKeys = {
  monitoringEnabled: "monitoring_enabled",
  digestEnabled: "digest_enabled",
  priorityAlertsEnabled: "priority_alerts_enabled",
} as const;

function numberValue(rows: Awaited<ReturnType<typeof listWorkspaceEntitlements>>, key: string, fallback = 0): number {
  const row = rows.find((candidate) => candidate.capability_key === key);
  return row?.value_type === "integer" || row?.value_type === "decimal"
    ? typeof row.value_json === "number" && Number.isFinite(row.value_json) ? row.value_json : fallback
    : fallback;
}

function booleanValue(rows: Awaited<ReturnType<typeof listWorkspaceEntitlements>>, key: string, fallback = false): boolean {
  const row = rows.find((candidate) => candidate.capability_key === key);
  return row?.value_type === "boolean" && typeof row.value_json === "boolean" ? row.value_json : fallback;
}

export async function resolveMonitoringPolicy(client: Client, workspaceId: string): Promise<MonitoringPolicy> {
  const rows = await listWorkspaceEntitlements(client, workspaceId);
  return {
    version: MONITORING_POLICY_VERSION,
    monitoringEnabled: booleanValue(rows, booleanKeys.monitoringEnabled),
    intelligenceCyclesPerDay: numberValue(rows, integerKeys.intelligenceCyclesPerDay),
    intelligenceCycleIntervalMinutes: numberValue(rows, integerKeys.intelligenceCycleIntervalMinutes),
    deepRefreshesPerWeek: numberValue(rows, integerKeys.deepRefreshesPerWeek),
    manualRefreshCooldownMinutes: numberValue(rows, integerKeys.manualRefreshCooldownMinutes),
    intelligenceCycleMaxSources: numberValue(rows, integerKeys.intelligenceCycleMaxSources),
    intelligenceCycleQueryBudget: numberValue(rows, integerKeys.intelligenceCycleQueryBudget),
    intelligenceCycleCandidateBudget: numberValue(rows, integerKeys.intelligenceCycleCandidateBudget),
    deepRefreshMaxSources: numberValue(rows, integerKeys.deepRefreshMaxSources),
    deepRefreshQueryBudget: numberValue(rows, integerKeys.deepRefreshQueryBudget),
    deepRefreshCandidateBudget: numberValue(rows, integerKeys.deepRefreshCandidateBudget),
    xMaxRequestsPerCycle: numberValue(rows, integerKeys.xMaxRequestsPerCycle),
    xMaxBillablePostsPerCycle: numberValue(rows, integerKeys.xMaxBillablePostsPerCycle),
    xMaxRequestsPerDeepRefresh: numberValue(rows, integerKeys.xMaxRequestsPerDeepRefresh),
    xMaxBillablePostsPerDeepRefresh: numberValue(rows, integerKeys.xMaxBillablePostsPerDeepRefresh),
    xDailyBudgetUsd: numberValue(rows, "x_daily_budget_usd"),
    digestEnabled: booleanValue(rows, booleanKeys.digestEnabled),
    priorityAlertsEnabled: booleanValue(rows, booleanKeys.priorityAlertsEnabled),
    demandDriftDays: numberValue(rows, "demand_drift_days"),
  };
}
