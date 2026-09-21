import "server-only";

import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { resolveMonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";

export type MonitoringOverview = {
  enabled: boolean;
  cadenceLabel: string;
  lastCycleAt: string | null;
  nextRefreshAt: string | null;
  sources: string[];
  lastStatus: "healthy" | "limited" | "failed" | "paused";
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
  const latest = await client.from("job_runs").select("status,input_reference").eq("workspace_id", workspaceId).eq("product_id", productId).eq("job_type", "discover-source").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const reference = jsonObject(latest.data?.input_reference);
  const result = jsonObject(reference.result);
  const sources = Array.isArray(result.sources) ? result.sources.filter((value): value is string => typeof value === "string").slice(0, 8) : [];
  const lastStatus = !schedule.enabled || !policy.monitoringEnabled
    ? "paused"
    : latest.data?.status === "failed" || latest.data?.status === "failed_terminal"
      ? "failed"
      : result.state === "complete_with_warnings"
        ? "limited"
        : "healthy";
  return {
    enabled: schedule.enabled && policy.monitoringEnabled,
    cadenceLabel: policy.intelligenceCyclesPerDay >= 12 ? "Throughout the day" : policy.intelligenceCyclesPerDay > 0 ? "Every few hours" : "Manual refreshes only",
    lastCycleAt: schedule.last_success_at ?? schedule.last_cycle_at,
    nextRefreshAt: [schedule.next_cycle_at, schedule.next_deep_refresh_at].filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    sources,
    lastStatus,
  };
}
