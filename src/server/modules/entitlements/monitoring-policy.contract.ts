import { jsonValueSchema, type Json } from "../../db/database.helpers";

export const MONITORING_POLICY_VERSION = "automatic-monitoring-v1" as const;

export type MonitoringPolicy = {
  version: typeof MONITORING_POLICY_VERSION;
  monitoringEnabled: boolean;
  intelligenceCyclesPerDay: number;
  intelligenceCycleIntervalMinutes: number;
  deepRefreshesPerWeek: number;
  manualRefreshCooldownMinutes: number;
  intelligenceCycleMaxSources: number;
  intelligenceCycleQueryBudget: number;
  intelligenceCycleCandidateBudget: number;
  deepRefreshMaxSources: number;
  deepRefreshQueryBudget: number;
  deepRefreshCandidateBudget: number;
  xMaxRequestsPerCycle: number;
  xMaxBillablePostsPerCycle: number;
  xMaxRequestsPerDeepRefresh: number;
  xMaxBillablePostsPerDeepRefresh: number;
  xDailyBudgetUsd: number;
  digestEnabled: boolean;
  priorityAlertsEnabled: boolean;
  demandDriftDays: number;
};

export function monitoringPolicySnapshot(policy: MonitoringPolicy): Json {
  return jsonValueSchema.parse({ ...policy });
}

export function demandDriftWindowAllowed(policy: MonitoringPolicy, requestedDays: number): boolean {
  return requestedDays > 0 && requestedDays <= policy.demandDriftDays;
}
