import "server-only";

import { createAdminServiceClient } from "./supabase";
import { getTriggerRunsSnapshot, type TriggerRunsSnapshot } from "./trigger-runs";

type Availability<T> = { value: T | null; source: string };
type Job = { id: string; status: string; jobType: string; createdAt: string; traceId: string; attemptCount: number; errorCode: string | null };
type StuckJob = { id: string; jobType: string; startedAt: string | null; createdAt: string; attemptCount: number; errorCode: string | null };
type Source = { sourceKey: string; state: "healthy" | "degraded" | "blocked" | "paused" | "disabled" | "stale" | "unknown"; lastCheckedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; latencyMs: number | null; errorCode: string | null; failureCount: number | null; nextRetryAt: string | null };
type MonitoringSummary = { enabledSchedules: number; disabledSchedules: number; statusCounts: Record<string, number>; lastCycleAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null };
type ProviderExecution = { sourceKey: string; plannedQueries: number; executedQueries: number; executions: number; successful: number; failed: number; rateLimitedExecutions: number; skippedQueries: number; providerResults: number; rawSnapshotsInserted: number; uniqueRoots: number; duplicateRoots: number; qualifiedRoots: number; pages: number; continuations: number; retries: number; lowestRateLimitRemaining: number | null; longestRetryAfterHintMs: number | null; averageRuntimeMs: number | null };
type SignalLifecycleCounts = { active: number; saved: number; dismissed: number; archived: number; invalidated: number; retracted: number };

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
  stuckJobs: Availability<StuckJob[]>;
  stuckJobCount: Availability<number>;
  sourceRows: Availability<Source[]>;
  monitoring: Availability<MonitoringSummary>;
  pipelineState: "disabled" | "unavailable" | "available";
  pipeline: Availability<{ providers: ProviderExecution[]; roots: number; qualifiedRoots: number; rangeStart: string }>;
  signalLifecycle: Availability<SignalLifecycleCounts>;
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
  stuckJobs: { value: null, source: "Supabase · job_runs · older than 30 minutes" },
  stuckJobCount: { value: null, source: "Supabase · job_runs · older than 30 minutes" },
  sourceRows: { value: null, source: "Supabase · source_health + source_controls" },
  monitoring: { value: null, source: "Supabase · monitoring_schedules" },
  pipelineState: "unavailable",
  pipeline: { value: null, source: "Supabase · source execution attribution · trailing 7 days" },
  signalLifecycle: { value: null, source: "Supabase · signals · all time" },
  lastSuccessAt: null,
  trigger: { state: "unavailable", checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" },
};

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const client = createAdminServiceClient();
  const trigger = await getTriggerRunsSnapshot();
  const telemetryEnabled = process.env.SOURCE_EXECUTION_OBSERVABILITY_ENABLED === "true";
  if (!client) return {
    ...unavailable,
    trigger,
    pipelineState: telemetryEnabled ? "unavailable" : "disabled",
    pipeline: { value: null, source: telemetryEnabled ? "Supabase · source execution attribution · trailing 7 days" : "Server configuration · source execution observability disabled" },
  };

  const checkedAt = new Date();
  const periodStart = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekStart = new Date(checkedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stuckBefore = new Date(checkedAt.getTime() - 30 * 60 * 1000).toISOString();
  const [jobCount, recentJobs, successfulJobs, healthRows, controlRows, stuckRows, stuckCount, monitoringRows, signalRows] = await Promise.all([
    client.from("job_runs").select("id", { count: "exact", head: true }).gte("created_at", periodStart),
    client.from("job_runs").select("id,status,job_type,created_at,trace_id,attempt_count,error_code").gte("created_at", periodStart).order("created_at", { ascending: false }).limit(12),
    client.from("job_runs").select("completed_at").eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("source_health").select("source_key,degradation_state,updated_at,last_success_at,last_failure_at,last_latency_ms,latest_error_code").eq("environment", "production"),
    client.from("source_controls").select("source_key,state,updated_at,failure_count,next_retry_at"),
    client.from("job_runs").select("id,job_type,created_at,started_at,attempt_count,error_code").eq("status", "running").lt("created_at", stuckBefore).order("created_at", { ascending: true }).limit(20),
    client.from("job_runs").select("id", { count: "exact", head: true }).eq("status", "running").lt("created_at", stuckBefore),
    client.from("monitoring_schedules").select("enabled,current_status,last_cycle_at,last_success_at,last_failure_at").limit(5001),
    client.from("signals").select("lifecycle_status").limit(10001),
  ]);
  const disabledTelemetryRead = { data: null, error: null } as const;
  const [executionRows, pageRows, queryRows, outcomeRows] = telemetryEnabled ? await Promise.all([
    client.from("source_query_executions").select("id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at").gte("created_at", weekStart).order("created_at", { ascending: false }).limit(5001),
    client.from("source_query_execution_pages").select("id,execution_id,attempt_count,continuation_followed,duration_ms,rate_limit_remaining,retry_after_ms").gte("observed_at", weekStart).limit(15001),
    client.from("query_yield_artifacts").select("source_key,execution_status").gte("created_at", weekStart).limit(5001),
    client.from("product_query_result_outcomes").select("source_query_result_attribution_id,conversation_id,qualification_status,created_at").gte("created_at", weekStart).limit(5001),
  ]) : [disabledTelemetryRead, disabledTelemetryRead, disabledTelemetryRead, disabledTelemetryRead];

  const pageIdsForResults = (pageRows.data ?? []).map((row) => String(row.id));
  const resultRows = !telemetryEnabled
    ? disabledTelemetryRead
    : pageRows.error
    ? { data: null, error: pageRows.error }
    : pageIdsForResults.length
      ? await client.from("source_query_result_attributions").select("id,page_id,conversation_id").in("page_id", pageIdsForResults).limit(5001)
      : { data: [], error: null };

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
  const stuckJobRows: StuckJob[] | null = stuckRows.error ? null : (stuckRows.data ?? []).map((row) => ({
    id: String(row.id), jobType: String(row.job_type), startedAt: typeof row.started_at === "string" ? row.started_at : null,
    createdAt: String(row.created_at), attemptCount: Number(row.attempt_count ?? 0), errorCode: typeof row.error_code === "string" ? row.error_code : null,
  }));
  const monitoringValue: MonitoringSummary | null = monitoringRows.error || (monitoringRows.data?.length ?? 0) > 5000 ? null : (() => {
    const rows = monitoringRows.data ?? [];
    const statusCounts: Record<string, number> = {};
    for (const row of rows) statusCounts[String(row.current_status ?? "unknown")] = (statusCounts[String(row.current_status ?? "unknown")] ?? 0) + 1;
    const maxDate = (field: "last_cycle_at" | "last_success_at" | "last_failure_at") => rows.map((row) => typeof row[field] === "string" ? String(row[field]) : null).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    return { enabledSchedules: rows.filter((row) => row.enabled === true).length, disabledSchedules: rows.filter((row) => row.enabled === false).length, statusCounts, lastCycleAt: maxDate("last_cycle_at"), lastSuccessAt: maxDate("last_success_at"), lastFailureAt: maxDate("last_failure_at") };
  })();

  const pipelineValue = !telemetryEnabled ? null : (() => {
    if (executionRows.error || pageRows.error || queryRows.error || resultRows.error || outcomeRows.error) return null;
    if ((executionRows.data?.length ?? 0) > 5000 || (pageRows.data?.length ?? 0) > 15000 || (queryRows.data?.length ?? 0) > 5000 || (resultRows.data?.length ?? 0) > 5000 || (outcomeRows.data?.length ?? 0) > 5000) return null;
    const executions = executionRows.data ?? [];
    const pages = pageRows.data ?? [];
    const results = resultRows.data ?? [];
    const outcomes = outcomeRows.data ?? [];
    const executionById = new Map(executions.map((row) => [String(row.id), String(row.source_key)]));
    const pageById = new Map(pages.map((row) => [String(row.id), String(row.execution_id)]));
    const resultById = new Map(results.map((row) => [String(row.id), { pageId: String(row.page_id), conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null }]));
    const aggregate = new Map<string, { plannedQueries: number; executedQueries: number; executions: number; successful: number; failed: number; rateLimitedExecutions: number; skippedQueries: number; providerResults: number; rawSnapshotsInserted: number; pages: number; continuations: number; retries: number; rateLimitRemaining: number[]; retryAfterHints: number[]; runtimeTotal: number; runtimeCount: number; roots: Set<string>; allRootRows: number; qualified: Set<string> }>();
    const bucket = (sourceKey: string) => {
      let value = aggregate.get(sourceKey);
      if (!value) { value = { plannedQueries: 0, executedQueries: 0, executions: 0, successful: 0, failed: 0, rateLimitedExecutions: 0, skippedQueries: 0, providerResults: 0, rawSnapshotsInserted: 0, pages: 0, continuations: 0, retries: 0, rateLimitRemaining: [], retryAfterHints: [], runtimeTotal: 0, runtimeCount: 0, roots: new Set(), allRootRows: 0, qualified: new Set() }; aggregate.set(sourceKey, value); }
      return value;
    };
    for (const execution of executions) {
      const sourceKey = String(execution.source_key);
      const stats = bucket(sourceKey);
      const status = String(execution.execution_status);
      stats.executions += 1;
      if (["completed_with_results", "completed_zero_results"].includes(status)) stats.successful += 1;
      if (["provider_error", "rate_limited", "degraded"].includes(status)) stats.failed += 1;
      if (status === "rate_limited") stats.rateLimitedExecutions += 1;
      stats.providerResults += Number(execution.provider_results_returned ?? 0);
      stats.rawSnapshotsInserted += Number(execution.raw_snapshots_inserted ?? 0);
      stats.continuations += Number(execution.continuation_count ?? 0);
      if (typeof execution.duration_ms === "number") { stats.runtimeTotal += execution.duration_ms; stats.runtimeCount += 1; }
    }
    for (const query of queryRows.data ?? []) {
      const status = String(query.execution_status);
      const stats = bucket(String(query.source_key));
      stats.plannedQueries += 1;
      if (["completed_with_results", "completed_zero_results", "provider_error", "rate_limited"].includes(status)) stats.executedQueries += 1;
      if (["budget_limited", "execution_suppressed", "disabled", "unavailable"].includes(status)) stats.skippedQueries += 1;
    }
    for (const page of pages) {
      const stats = bucket(executionById.get(String(page.execution_id)) ?? "unknown");
      stats.pages += 1;
      stats.retries += Math.max(0, Number(page.attempt_count ?? 1) - 1);
      if (typeof page.rate_limit_remaining === "number") stats.rateLimitRemaining.push(page.rate_limit_remaining);
      if (typeof page.retry_after_ms === "number") stats.retryAfterHints.push(page.retry_after_ms);
    }
    for (const result of results) {
      if (typeof result.conversation_id !== "string") continue;
      const executionId = pageById.get(String(result.page_id));
      const sourceKey = executionId ? executionById.get(executionId) : null;
      if (!sourceKey) continue;
      const stats = bucket(sourceKey);
      stats.allRootRows += 1;
      stats.roots.add(result.conversation_id);
    }
    for (const outcome of outcomes) {
      if (String(outcome.qualification_status) !== "qualified" || typeof outcome.conversation_id !== "string") continue;
      const attribution = resultById.get(String(outcome.source_query_result_attribution_id));
      if (!attribution) continue;
      const executionId = pageById.get(attribution.pageId);
      const sourceKey = executionId ? executionById.get(executionId) : null;
      if (sourceKey) bucket(sourceKey).qualified.add(outcome.conversation_id);
    }
    const providers: ProviderExecution[] = [...aggregate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sourceKey, stats]) => ({
      sourceKey, plannedQueries: stats.plannedQueries, executedQueries: stats.executedQueries, executions: stats.executions, successful: stats.successful, failed: stats.failed, rateLimitedExecutions: stats.rateLimitedExecutions, skippedQueries: stats.skippedQueries,
      providerResults: stats.providerResults, rawSnapshotsInserted: stats.rawSnapshotsInserted, uniqueRoots: stats.roots.size,
      duplicateRoots: Math.max(0, stats.allRootRows - stats.roots.size), qualifiedRoots: stats.qualified.size,
      pages: stats.pages, continuations: stats.continuations, retries: stats.retries,
      lowestRateLimitRemaining: stats.rateLimitRemaining.length ? Math.min(...stats.rateLimitRemaining) : null,
      longestRetryAfterHintMs: stats.retryAfterHints.length ? Math.max(...stats.retryAfterHints) : null,
      averageRuntimeMs: stats.runtimeCount ? Math.round(stats.runtimeTotal / stats.runtimeCount) : null,
    }));
    return { providers, roots: new Set(providers.flatMap((provider) => [...(aggregate.get(provider.sourceKey)?.roots ?? [])])).size, qualifiedRoots: new Set(providers.flatMap((provider) => [...(aggregate.get(provider.sourceKey)?.qualified ?? [])])).size, rangeStart: weekStart };
  })();

  const signalLifecycleValue: SignalLifecycleCounts | null = signalRows.error || (signalRows.data?.length ?? 0) > 10000 ? null : (signalRows.data ?? []).reduce((counts, row) => {
    const status = String(row.lifecycle_status) as keyof SignalLifecycleCounts;
    if (status in counts) counts[status] += 1;
    return counts;
  }, { active: 0, saved: 0, dismissed: 0, archived: 0, invalidated: 0, retracted: 0 });
  const hasDataError = Boolean(jobCount.error || recentJobs.error || healthRows.error || controlRows.error || stuckRows.error || stuckCount.error || monitoringRows.error || signalRows.error || (telemetryEnabled && (executionRows.error || pageRows.error || queryRows.error || resultRows.error || outcomeRows.error)));
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
    stuckJobs: { value: stuckJobRows, source: "Supabase · job_runs · running for more than 30 minutes" },
    stuckJobCount: { value: stuckCount.error ? null : stuckCount.count ?? 0, source: "Supabase · job_runs · running for more than 30 minutes" },
    sourceRows: { value: sourceRowsValue, source: "Supabase · source_health + source_controls · production · refreshed now" },
    monitoring: { value: monitoringValue, source: "Supabase · monitoring_schedules · current recorded state" },
    pipelineState: !telemetryEnabled ? "disabled" : pipelineValue === null ? "unavailable" : "available",
    pipeline: { value: pipelineValue, source: telemetryEnabled ? "Supabase · source execution and product outcome attribution · trailing 7 days" : "Server configuration · source execution observability disabled" },
    signalLifecycle: { value: signalLifecycleValue, source: "Supabase · signals · all time" },
    lastSuccessAt: successfulJobs.error ? null : successfulJobs.data?.completed_at ?? null,
    trigger,
  };
}
