import "server-only";

import { createAdminServiceClient } from "./supabase";
import { getTriggerRunsSnapshot, type TriggerRunsSnapshot } from "./trigger-runs";

type Availability<T> = { value: T | null; source: string };
type Job = { id: string; status: string; jobType: string; createdAt: string; traceId: string; attemptCount: number; errorCode: string | null };
type Source = { sourceKey: string; state: "healthy" | "degraded" | "blocked" | "paused" | "disabled" | "stale" | "unknown"; lastCheckedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; latencyMs: number | null; errorCode: string | null; failureCount: number | null; nextRetryAt: string | null };

export type OperationsSnapshot = {
  checkedAt: string | null;
  databaseRead: boolean | null;
  state: "unknown" | "degraded";
  stateLabel: string;
  label: string;
  description: string;
  jobs: Availability<number>;
  sources: Availability<number>;
  recentJobs: Availability<Job[]>;
  sourceRows: Availability<Source[]>;
  lastSuccessAt: string | null;
  trigger: TriggerRunsSnapshot;
};

const unavailable: OperationsSnapshot = {
  checkedAt: null,
  databaseRead: null,
  state: "unknown",
  stateLabel: "Unavailable",
  label: "Operations data is unavailable",
  description: "Configure the server-side Supabase connection and apply the admin foundation migration to enable this view.",
  jobs: { value: null, source: "Supabase · job_runs" },
  sources: { value: null, source: "Supabase · source_health" },
  recentJobs: { value: null, source: "Supabase · job_runs" },
  sourceRows: { value: null, source: "Supabase · source_health + source_controls" },
  lastSuccessAt: null,
  trigger: { state: "unavailable", checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" },
};

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const client = createAdminServiceClient();
  const trigger = await getTriggerRunsSnapshot();
  if (!client) return { ...unavailable, trigger };

  const checkedAt = new Date();
  const periodStart = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [jobCount, recentJobs, successfulJobs, healthRows, controlRows] = await Promise.all([
    client.from("job_runs").select("id", { count: "exact", head: true }).gte("created_at", periodStart),
    client.from("job_runs").select("id,status,job_type,created_at,trace_id,attempt_count,error_code").gte("created_at", periodStart).order("created_at", { ascending: false }).limit(12),
    client.from("job_runs").select("completed_at").eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("source_health").select("source_key,degradation_state,updated_at,last_success_at,last_failure_at,last_latency_ms,latest_error_code").eq("environment", "production"),
    client.from("source_controls").select("source_key,state,updated_at,failure_count,next_retry_at"),
  ]);

  const recentJobRows = recentJobs.error ? null : (recentJobs.data ?? []).map((row) => ({
    id: String(row.id), status: String(row.status), jobType: String(row.job_type), createdAt: String(row.created_at), traceId: String(row.trace_id),
    attemptCount: Number(row.attempt_count ?? 0), errorCode: typeof row.error_code === "string" ? row.error_code : null,
  }));
  const controls = new Map((controlRows.error ? [] : controlRows.data ?? []).map((row) => [String(row.source_key), row]));
  const health = new Map((healthRows.error ? [] : healthRows.data ?? []).map((row) => [String(row.source_key), row]));
  const sourceRowsValue: Source[] | null = healthRows.error || controlRows.error ? null : [...new Set([...health.keys(), ...controls.keys()])].map((sourceKey) => {
    const row = health.get(sourceKey);
    const controlled = controls.get(sourceKey);
    const controlState = String(controlled?.state ?? "enabled");
    const checked = row?.updated_at ? String(row.updated_at) : controlled?.updated_at ? String(controlled.updated_at) : null;
    const age = checked === null ? Number.POSITIVE_INFINITY : checkedAt.getTime() - Date.parse(checked);
    const fresh = checked !== null && Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000;
    const state: Source["state"] = controlState === "disabled" ? "disabled"
      : controlState === "paused" ? "paused"
        : row && fresh && ["healthy", "degraded", "blocked"].includes(String(row.degradation_state))
          ? row.degradation_state as Source["state"]
          : checked && !fresh ? "stale" : "unknown";
    return {
      sourceKey, state, lastCheckedAt: checked,
      lastSuccessAt: row?.last_success_at ? String(row.last_success_at) : null,
      lastFailureAt: row?.last_failure_at ? String(row.last_failure_at) : null,
      latencyMs: typeof row?.last_latency_ms === "number" ? row.last_latency_ms : null,
      errorCode: row?.latest_error_code ? String(row.latest_error_code) : null,
      failureCount: typeof controlled?.failure_count === "number" ? controlled.failure_count : null,
      nextRetryAt: controlled?.next_retry_at ? String(controlled.next_retry_at) : null,
    };
  });

  const failures = recentJobRows?.filter((job) => ["failed", "failed_terminal"].includes(job.status)).length ?? 0;
  const triggerFailures = trigger.runs?.filter((run) => ["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(run.status)).length ?? 0;
  const hasDataError = Boolean(jobCount.error || recentJobs.error || healthRows.error || controlRows.error);
  const state = hasDataError || failures > 0 || triggerFailures > 0 ? "degraded" : "unknown";
  return {
    checkedAt: checkedAt.toISOString(),
    databaseRead: !hasDataError,
    state,
    stateLabel: hasDataError ? "Partial data" : failures + triggerFailures > 0 ? `${failures + triggerFailures} failed runs in 24 hours` : "Read checks connected",
    label: hasDataError ? "Some operational data could not be read" : failures + triggerFailures > 0 ? `${failures + triggerFailures} failed runs in the last 24 hours` : "Persisted health and run state loaded",
    description: trigger.state === "available" ? "Supabase job and source records plus live Trigger.dev production runs. Provider availability remains based on recorded source checks." : "Supabase job and source records are live. Trigger.dev production state is unavailable until a production-scoped server key is configured.",
    jobs: { value: jobCount.error ? null : jobCount.count ?? 0, source: "Supabase · job_runs · trailing 24 hours" },
    sources: { value: sourceRowsValue === null ? null : sourceRowsValue.length, source: "Supabase · source_health + source_controls · production" },
    recentJobs: { value: recentJobRows, source: "Supabase · job_runs · trailing 24 hours · refreshed now" },
    sourceRows: { value: sourceRowsValue, source: "Supabase · source_health + source_controls · production · refreshed now" },
    lastSuccessAt: successfulJobs.error ? null : successfulJobs.data?.completed_at ?? null,
    trigger,
  };
}
