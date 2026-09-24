import "server-only";

import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { resolveMonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";
import { getScanSourceHealthReadModel, type SourceHealthCoverageLabel, type SourceHealthReadModel } from "@/server/modules/operations/source-health-read-model";
import { deriveMonitoringStatus, type MonitoringDisplayStatus } from "./monitoring.view-model";

export type MonitoringOverview = {
  plan: "free" | "pro" | "growth";
  enabled: boolean;
  cadenceLabel: string;
  lastCycleAt: string | null;
  lastCheckedAt: string | null;
  nextRefreshAt: string | null;
  nextCheckAt: string | null;
  sources: string[];
  lastStatus: MonitoringDisplayStatus;
  sourceHealthV1: SourceHealthReadModel | null;
  coverageLabel: SourceHealthCoverageLabel | null;
  coverageCopy: string | null;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getMonitoringOverview(workspaceId: string, productId: string): Promise<MonitoringOverview | null> {
  const client = createSupabaseServiceClient();
  const [scheduleResult, policy] = await Promise.all([
    client.from("monitoring_schedules").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).maybeSingle(),
    resolveMonitoringPolicy(client, workspaceId),
  ]);
  if (scheduleResult.error || !scheduleResult.data) return null;
  const schedule = scheduleResult.data;
  const latest = schedule.last_job_run_id
    ? await client.from("job_runs").select("status,input_reference").eq("id", schedule.last_job_run_id).maybeSingle()
    : { data: null, error: null };
  const reference = jsonObject(latest.data?.input_reference);
  const result = jsonObject(reference.result);
  const sources = Array.isArray(result.sources) ? result.sources.filter((value): value is string => typeof value === "string").slice(0, 8) : [];
  const sourceHealthV1 = getScanSourceHealthReadModel(result.sourceHealthV1);
  const lastStatus = deriveMonitoringStatus({
    enabled: schedule.enabled,
    policyEnabled: policy.monitoringEnabled,
    currentStatus: schedule.current_status,
    jobStatus: latest.data?.status,
    resultState: typeof result.state === "string" ? result.state : null,
    sourceHealthLabel: sourceHealthV1?.coverage.label ?? null,
  });
  return {
    plan: policy.plan ?? "free",
    enabled: schedule.enabled && policy.monitoringEnabled,
    cadenceLabel: policy.intelligenceCyclesPerDay >= 12 ? "Throughout the day" : policy.intelligenceCyclesPerDay > 0 ? "Every few hours" : "Manual refreshes only",
    lastCycleAt: schedule.last_success_at ?? schedule.last_cycle_at,
    lastCheckedAt: schedule.last_dispatch_at ?? schedule.last_success_at ?? schedule.last_cycle_at,
    nextRefreshAt: [schedule.next_cycle_at, schedule.next_deep_refresh_at].filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    nextCheckAt: [schedule.next_cycle_at, schedule.next_deep_refresh_at].filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    sources,
    lastStatus,
    sourceHealthV1,
    coverageLabel: sourceHealthV1?.coverage.label ?? null,
    coverageCopy: sourceHealthV1 && sourceHealthV1.coverage.label !== "full_coverage" ? sourceHealthV1.coverage.copy : null,
  };
}
