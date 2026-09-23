import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import { getProviderBudget, resolveWorkspaceCapabilities } from "./plan-capabilities";
import { MONITORING_POLICY_VERSION, type MonitoringPolicy } from "./monitoring-policy.contract";

export { MONITORING_POLICY_VERSION, monitoringPolicySnapshot, demandDriftWindowAllowed } from "./monitoring-policy.contract";
export type { MonitoringPolicy } from "./monitoring-policy.contract";

type Client = SupabaseClient<Database>;

export async function resolveMonitoringPolicy(client: Client, workspaceId: string): Promise<MonitoringPolicy> {
  const capabilities = await resolveWorkspaceCapabilities(client, workspaceId);
  const monitoring = capabilities.scanProfiles.monitoring;
  const deep = capabilities.scanProfiles.scheduled_deep_discovery;
  const xMonitoring = getProviderBudget(capabilities, "x", "monitoring");
  const xDeep = getProviderBudget(capabilities, "x", "scheduled_deep_discovery");
  return {
    version: MONITORING_POLICY_VERSION,
    plan: capabilities.plan,
    monitoringEnabled: capabilities.monitoring.enabled,
    intelligenceCyclesPerDay: capabilities.monitoring.targetCyclesPerDay,
    intelligenceCycleIntervalMinutes: capabilities.monitoring.monitoringIntervalMinutes ?? 0,
    deepRefreshesPerWeek: capabilities.monitoring.deepDiscoveryIntervalDays ? 7 / capabilities.monitoring.deepDiscoveryIntervalDays : 0,
    manualRefreshCooldownMinutes: capabilities.plan === "free" ? 1440 : capabilities.plan === "pro" ? 180 : 60,
    intelligenceCycleMaxSources: monitoring.maxSourcesPerScan,
    intelligenceCycleQueryBudget: monitoring.maxQueriesPerScan,
    intelligenceCycleCandidateBudget: monitoring.maxCandidatesPerScan,
    deepRefreshMaxSources: deep.maxSourcesPerScan,
    deepRefreshQueryBudget: deep.maxQueriesPerScan,
    deepRefreshCandidateBudget: deep.maxCandidatesPerScan,
    xMaxRequestsPerCycle: capabilities.monitoring.enabled ? xMonitoring.maxQueriesPerCycle : 0,
    xMaxBillablePostsPerCycle: capabilities.monitoring.enabled ? xMonitoring.maxCandidatesPerCycle : 0,
    xMaxRequestsPerDeepRefresh: deep.enabled ? xDeep.maxQueriesPerCycle : 0,
    xMaxBillablePostsPerDeepRefresh: deep.enabled ? xDeep.maxCandidatesPerCycle : 0,
    xDailyBudgetUsd: capabilities.plan === "free" ? 0 : capabilities.plan === "pro" ? 0.5 : 2,
    digestEnabled: capabilities.monitoring.enabled,
    priorityAlertsEnabled: capabilities.plan === "growth",
    demandDriftDays: capabilities.history.driftHistoryDays,
  };
}
