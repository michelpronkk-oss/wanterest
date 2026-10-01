import "server-only";

import { createAdminServiceClient } from "./supabase";
import { getTriggerRunsSnapshot, type TriggerRunsSnapshot } from "./trigger-runs";

type Availability<T> = { value: T | null; source: string };
type Job = { id: string; status: string; jobType: string; createdAt: string; traceId: string; attemptCount: number; errorCode: string | null };
type StuckJob = { id: string; jobType: string; startedAt: string | null; createdAt: string; attemptCount: number; errorCode: string | null };
type Source = { sourceKey: string; state: "healthy" | "degraded" | "blocked" | "paused" | "disabled" | "stale" | "unknown"; lastCheckedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; latencyMs: number | null; errorCode: string | null; failureCount: number | null; nextRetryAt: string | null };
type MonitoringSummary = { enabledSchedules: number; disabledSchedules: number; statusCounts: Record<string, number>; lastCycleAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null };
type ProviderExecution = { sourceKey: string; plannedQueries: number; executedQueries: number; executions: number; successful: number; failed: number; rateLimitedExecutions: number; skippedQueries: number; providerResults: number; rawSnapshotsInserted: number; uniqueRoots: number; duplicateRoots: number; qualifiedRoots: number; pages: number; continuations: number; retries: number; lowestRateLimitRemaining: number | null; longestRetryAfterHintMs: number | null; averageRuntimeMs: number | null };
type QueryNoveltyBucket = { sourceKey: string; intentFamily: string; variantVersion: string; selectionReason: string | null; noveltyState: string | null; executions: number; providerResults: number; rawSnapshotsInserted: number; rawSnapshotsDuplicate: number; uniqueProviderItems: number; normalizedItems: number; attributableResults: number; rootAttributions: number; independentRoots: number; newRootAttributions: number; firstSeenRoots: number; newIndependentEvidenceEligibleRoots: number; repeatedRoots: number; sameScanDuplicates: number; evidenceEligibleRoots: number; evidenceEligibilityKnownRoots: number; evaluatedRoots: number; qualifiedRoots: number; newIndependentQualifiedRoots: number; signals: number; newRootRate: number | null; eligibleRootRate: number | null; qualifiedRootRate: number | null };
type QueryNovelty = { rangeStart: string; rangeEnd: string; executions: number; sources: string[]; intentFamilies: string[]; providerResults: number; rawSnapshotsInserted: number; rawSnapshotsDuplicate: number; uniqueProviderItems: number; normalizedItems: number; attributableResults: number; independentRoots: number; firstSeenRoots: number; newIndependentEvidenceEligibleRoots: number; newRootAttributions: number; repeatedRoots: number; sameScanDuplicates: number; evidenceEligibleRoots: number; evidenceEligibilityKnownRoots: number; evaluatedRoots: number; qualifiedRoots: number; newIndependentQualifiedRoots: number; newRootRate: number | null; eligibleRootRate: number | null; qualifiedRootRate: number | null; truncated: boolean; buckets: QueryNoveltyBucket[]; latestExecutionAt: string | null };
type QueryExplorationDiagnostics = {
  completedAt: string | null;
  queryCountBefore: number;
  queryCountAfter: number;
  candidateCount: number;
  unselectedCandidateCount: number;
  recentlyExecutedCandidateCount: number;
  previouslyExecutedCandidateCount: number;
  unseenCandidateCount: number;
  rotatedSelectionCount: number;
  immediatelyRepeatedCandidateCount: number;
  immediatelyRepeatedSelectionCount: number;
  persistentLowNoveltyCandidateCount: number;
  recentZeroNoveltyCandidateCount: number;
  selectedReasonCounts: Array<{ reason: string; count: number }>;
  noveltyStateCounts: Array<{ state: string; count: number }>;
  candidatePoolBySource: Array<{ sourceKey: string; validCandidates: number; selected: number; unselected: number }>;
  familyCoverageBySource: Array<{ sourceKey: string; families: number }>;
  familyCoverageHistoryBySource: Array<{ sourceKey: string; zeroScansCandidates: number; oneScanCandidates: number; twoScansCandidates: number; threeScansCandidates: number }>;
};
type SignalLifecycleCounts = { active: number; saved: number; dismissed: number; archived: number; invalidated: number; retracted: number };
type EvaluationBacklog = { enqueued: number; pending: number; processing: number; succeeded: number; skipped: number; failed: number; exhausted: number; oldestPendingAt: string | null; evaluated24h: number; qualified24h: number; evaluatedHour: number; qualifiedHour: number; averageWaitSeconds: number | null; averageAttempts: number | null };

const selectionReasons = new Set([
  "v1_confidence_family_diversity", "cold_start_exploration", "unseen_variant_exploration", "recency_rotation",
  "recent_zero_novelty_rotation", "intent_coverage", "historical_yield", "default_rank",
  "persistent_low_novelty_penalty", "history_unavailable_fallback",
]);
const noveltyStates = new Set(["cold_start", "insufficient_history", "observed", "low_novelty", "history_unavailable"]);

function safeCountRecord(value: unknown, allowed?: Set<string>): Array<{ key: string; count: number }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 40 || entries.some(([key, count]) => (allowed && !allowed.has(key)) || !Number.isSafeInteger(count) || Number(count) < 0)) return null;
  return entries.map(([key, count]) => ({ key, count: Number(count) })).sort((left, right) => left.key.localeCompare(right.key));
}

function explorationDiagnostics(value: unknown, completedAt: unknown): QueryExplorationDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const integerFields = ["queryCountBefore", "queryCountAfter", "candidateCount", "unselectedCandidateCount", "recentlyExecutedCandidateCount", "previouslyExecutedCandidateCount", "unseenCandidateCount", "rotatedSelectionCount", "immediatelyRepeatedCandidateCount", "immediatelyRepeatedSelectionCount", "persistentLowNoveltyCandidateCount", "recentZeroNoveltyCandidateCount"] as const;
  if (result.historyState !== "available" || integerFields.some((key) => !Number.isSafeInteger(result[key]) || Number(result[key]) < 0)) return null;
  const selectedReasonCounts = safeCountRecord(result.selectedReasonCounts, selectionReasons);
  const noveltyStateCounts = safeCountRecord(result.noveltyStateCounts, noveltyStates);
  if (!selectedReasonCounts || !noveltyStateCounts) return null;
  if (!result.candidatePoolBySource || typeof result.candidatePoolBySource !== "object" || Array.isArray(result.candidatePoolBySource)
    || !result.familyCoverageBySource || typeof result.familyCoverageBySource !== "object" || Array.isArray(result.familyCoverageBySource)
    || !result.familyCoverageHistoryBySource || typeof result.familyCoverageHistoryBySource !== "object" || Array.isArray(result.familyCoverageHistoryBySource)) return null;
  const sourceEntries = Object.entries(result.candidatePoolBySource as Record<string, unknown>);
  const familyEntries = Object.entries(result.familyCoverageBySource as Record<string, unknown>);
  const familyHistoryEntries = Object.entries(result.familyCoverageHistoryBySource as Record<string, unknown>);
  if (sourceEntries.length > 30 || familyEntries.length > 30 || familyHistoryEntries.length > 30) return null;
  const candidatePoolBySource: QueryExplorationDiagnostics["candidatePoolBySource"] = [];
  for (const [sourceKey, raw] of sourceEntries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(sourceKey) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (["validCandidates", "selected", "unselected"].some((key) => !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)
      || Number(row.selected) > Number(row.validCandidates) || Number(row.unselected) !== Number(row.validCandidates) - Number(row.selected)) return null;
    candidatePoolBySource.push({ sourceKey, validCandidates: Number(row.validCandidates), selected: Number(row.selected), unselected: Number(row.unselected) });
  }
  const familyCoverageBySource: QueryExplorationDiagnostics["familyCoverageBySource"] = [];
  for (const [sourceKey, families] of familyEntries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(sourceKey) || !Number.isSafeInteger(families) || Number(families) < 0) return null;
    familyCoverageBySource.push({ sourceKey, families: Number(families) });
  }
  const familyCoverageHistoryBySource: QueryExplorationDiagnostics["familyCoverageHistoryBySource"] = [];
  for (const [sourceKey, raw] of familyHistoryEntries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(sourceKey) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const keys = ["zeroScansCandidates", "oneScanCandidates", "twoScansCandidates", "threeScansCandidates"] as const;
    if (keys.some((key) => !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)) return null;
    const candidatePool = candidatePoolBySource.find((candidate) => candidate.sourceKey === sourceKey);
    if (!candidatePool || keys.reduce((total, key) => total + Number(row[key]), 0) !== candidatePool.validCandidates) return null;
    familyCoverageHistoryBySource.push({ sourceKey, zeroScansCandidates: Number(row.zeroScansCandidates), oneScanCandidates: Number(row.oneScanCandidates), twoScansCandidates: Number(row.twoScansCandidates), threeScansCandidates: Number(row.threeScansCandidates) });
  }
  if (familyCoverageHistoryBySource.length !== candidatePoolBySource.length) return null;
  const completed = typeof completedAt === "string" && Number.isFinite(Date.parse(completedAt)) ? completedAt : null;
  return {
    completedAt: completed,
    queryCountBefore: Number(result.queryCountBefore), queryCountAfter: Number(result.queryCountAfter),
    candidateCount: Number(result.candidateCount), unselectedCandidateCount: Number(result.unselectedCandidateCount),
    recentlyExecutedCandidateCount: Number(result.recentlyExecutedCandidateCount),
    previouslyExecutedCandidateCount: Number(result.previouslyExecutedCandidateCount), unseenCandidateCount: Number(result.unseenCandidateCount),
    rotatedSelectionCount: Number(result.rotatedSelectionCount), immediatelyRepeatedCandidateCount: Number(result.immediatelyRepeatedCandidateCount),
    immediatelyRepeatedSelectionCount: Number(result.immediatelyRepeatedSelectionCount), persistentLowNoveltyCandidateCount: Number(result.persistentLowNoveltyCandidateCount),
    recentZeroNoveltyCandidateCount: Number(result.recentZeroNoveltyCandidateCount),
    selectedReasonCounts: selectedReasonCounts.map(({ key, count }) => ({ reason: key, count })),
    noveltyStateCounts: noveltyStateCounts.map(({ key, count }) => ({ state: key, count })),
    candidatePoolBySource: candidatePoolBySource.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    familyCoverageBySource: familyCoverageBySource.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    familyCoverageHistoryBySource: familyCoverageHistoryBySource.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
  };
}

function backlogSummary(value: unknown): EvaluationBacklog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ["enqueued", "pending", "processing", "succeeded", "skipped", "failed", "exhausted", "evaluated_24h", "qualified_24h", "evaluated_hour", "qualified_hour"] as const;
  if (keys.some((key) => !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)) return null;
  if (row.oldest_pending_at !== null && typeof row.oldest_pending_at !== "string") return null;
  if (row.average_wait_seconds !== null && (typeof row.average_wait_seconds !== "number" || !Number.isFinite(row.average_wait_seconds))) return null;
  if (row.average_attempts !== null && (typeof row.average_attempts !== "number" || !Number.isFinite(row.average_attempts))) return null;
  return { enqueued: Number(row.enqueued), pending: Number(row.pending), processing: Number(row.processing),
    succeeded: Number(row.succeeded), skipped: Number(row.skipped), failed: Number(row.failed), exhausted: Number(row.exhausted),
    oldestPendingAt: row.oldest_pending_at as string | null, evaluated24h: Number(row.evaluated_24h), qualified24h: Number(row.qualified_24h),
    evaluatedHour: Number(row.evaluated_hour), qualifiedHour: Number(row.qualified_hour),
    averageWaitSeconds: row.average_wait_seconds as number | null, averageAttempts: row.average_attempts as number | null };
}

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
  queryNovelty: Availability<QueryNovelty>;
  queryExplorationState: "disabled" | "unavailable" | "empty" | "available";
  queryExploration: Availability<QueryExplorationDiagnostics>;
  signalLifecycle: Availability<SignalLifecycleCounts>;
  evaluationBacklog: Availability<EvaluationBacklog>;
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
  queryNovelty: { value: null, source: "Supabase · private signal query novelty history · trailing 7 days" },
  queryExplorationState: "unavailable",
  queryExploration: { value: null, source: "Supabase · completed product scans · bounded aggregate diagnostics" },
  signalLifecycle: { value: null, source: "Supabase · signals · all time" },
  evaluationBacklog: { value: null, source: "Supabase · evaluation_backlog_summary · current state / trailing 24 hours" },
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
    queryNovelty: { value: null, source: telemetryEnabled ? "Supabase · private signal query novelty history · trailing 7 days" : "Server configuration · source execution observability disabled" },
    queryExplorationState: telemetryEnabled ? "unavailable" : "disabled",
    queryExploration: { value: null, source: telemetryEnabled ? "Supabase · completed product scans · bounded aggregate diagnostics" : "Server configuration · source execution observability disabled" },
  };

  const checkedAt = new Date();
  const backlogResult = typeof client.rpc === "function" ? await client.rpc("evaluation_backlog_summary") : { data: null, error: { message: "RPC unavailable" } };
  const backlogValue = backlogResult.error ? null : backlogSummary(backlogResult.data);
  const periodStart = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekStart = new Date(checkedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stuckBefore = new Date(checkedAt.getTime() - 30 * 60 * 1000).toISOString();
  const [jobCount, recentJobs, successfulJobs, healthRows, controlRows, stuckRows, stuckCount, monitoringRows, signalRows, explorationScanRows] = await Promise.all([
    client.from("job_runs").select("id", { count: "exact", head: true }).gte("created_at", periodStart),
    client.from("job_runs").select("id,status,job_type,created_at,trace_id,attempt_count,error_code").gte("created_at", periodStart).order("created_at", { ascending: false }).limit(12),
    client.from("job_runs").select("completed_at").eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("source_health").select("source_key,degradation_state,updated_at,last_success_at,last_failure_at,last_latency_ms,latest_error_code").eq("environment", "production"),
    client.from("source_controls").select("source_key,state,updated_at,failure_count,next_retry_at"),
    client.from("job_runs").select("id,job_type,created_at,started_at,attempt_count,error_code").eq("status", "running").lt("created_at", stuckBefore).order("created_at", { ascending: true }).limit(20),
    client.from("job_runs").select("id", { count: "exact", head: true }).eq("status", "running").lt("created_at", stuckBefore),
    client.from("monitoring_schedules").select("enabled,current_status,last_cycle_at,last_success_at,last_failure_at").limit(5001),
    client.from("signals").select("lifecycle_status").limit(10001),
    telemetryEnabled
      ? client.from("job_runs").select("completed_at,exploration:input_reference->result->queryPlanning->signalQueryExplorationV11").eq("job_type", "product-demand-scan").eq("status", "succeeded").gte("completed_at", weekStart).order("completed_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const disabledTelemetryRead = { data: null, error: null } as const;
  const queryNoveltyStart = new Date(checkedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const noveltyHistoryPromise = telemetryEnabled && typeof client.rpc === "function"
    ? client.rpc("signal_query_novelty_history", { p_workspace_id: null, p_product_id: null, p_since: queryNoveltyStart, p_max_scans: 12 })
    : Promise.resolve(disabledTelemetryRead);
  const [executionRows, pageRows, queryRows, outcomeRows] = telemetryEnabled ? await Promise.all([
    client.from("source_query_executions").select("id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at").gte("created_at", weekStart).order("created_at", { ascending: false }).limit(5001),
    client.from("source_query_execution_pages").select("id,execution_id,attempt_count,continuation_followed,duration_ms,rate_limit_remaining,retry_after_ms").gte("observed_at", weekStart).limit(15001),
    client.from("query_yield_artifacts").select("source_key,execution_status").gte("created_at", weekStart).limit(5001),
    client.from("product_query_result_outcomes").select("source_query_result_attribution_id,conversation_id,qualification_status,created_at").gte("created_at", weekStart).limit(5001),
  ]) : [disabledTelemetryRead, disabledTelemetryRead, disabledTelemetryRead, disabledTelemetryRead];
  const noveltyHistory = await noveltyHistoryPromise;
  const latestExploration = telemetryEnabled && !explorationScanRows.error
    ? (explorationScanRows.data ?? []).map((row) => explorationDiagnostics(row.exploration, row.completed_at)).find((row): row is QueryExplorationDiagnostics => row !== null) ?? null
    : null;

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
  const queryNoveltyValue: QueryNovelty | null = !telemetryEnabled || noveltyHistory.error
    ? null
    : (() => {
      const rows = Array.isArray(noveltyHistory.data) ? noveltyHistory.data as Array<Record<string, unknown>> : null;
      if (!rows || rows.length > 20_000) return null;
      const grouped = new Map<string, QueryNoveltyBucket>();
      let executions = 0;
      let firstSeenRoots = 0;
      let newRootAttributions = 0;
      let repeatedRoots = 0;
      let sameScanDuplicates = 0;
      let truncated = false;
      let providerResults = 0;
      let rawSnapshotsInserted = 0;
      let rawSnapshotsDuplicate = 0;
      let uniqueProviderItems = 0;
      let normalizedItems = 0;
      let attributableResults = 0;
      let independentRoots = 0;
      let newIndependentEvidenceEligibleRoots = 0;
      let evidenceEligibleRoots = 0;
      let evidenceEligibilityKnownRoots = 0;
      let evaluatedRoots = 0;
      let qualifiedRoots = 0;
      let newIndependentQualifiedRoots = 0;
      let latestExecutionAt: string | null = null;
      const sources = new Set<string>();
      const families = new Set<string>();
      for (const row of rows) {
        const numeric = ["provider_results", "raw_snapshots_inserted", "raw_snapshots_duplicate", "unique_provider_items", "normalized_items", "attributable_results", "unique_roots", "independent_roots", "new_root_attributions", "new_independent_roots", "known_root_attributions", "duplicate_root_attributions", "evidence_eligible_roots", "new_independent_evidence_eligible_roots", "evidence_eligibility_known_roots", "evaluated_roots", "qualified_roots", "new_independent_qualified_roots", "signal_roots"];
        if (numeric.some((field) => !Number.isSafeInteger(row[field]) || Number(row[field]) < 0)
          || typeof row.source_key !== "string" || typeof row.intent_family !== "string"
          || typeof row.query_variant_version !== "string" || typeof row.completed_at !== "string"
          || (row.selection_reason !== null && typeof row.selection_reason !== "string")
          || (row.novelty_state !== null && typeof row.novelty_state !== "string")
          || typeof row.history_truncated !== "boolean"
          || !Number.isFinite(Date.parse(row.completed_at))) return null;
        const sourceKey = row.source_key;
        const intentFamily = row.intent_family;
        const variantVersion = row.query_variant_version;
        const selectionReason = typeof row.selection_reason === "string" ? row.selection_reason : null;
        const noveltyState = typeof row.novelty_state === "string" ? row.novelty_state : null;
        const key = `${sourceKey}\u0000${intentFamily}\u0000${variantVersion}\u0000${selectionReason ?? "unrecorded"}\u0000${noveltyState ?? "unrecorded"}`;
        const bucket = grouped.get(key) ?? { sourceKey, intentFamily, variantVersion, selectionReason, noveltyState, executions: 0, providerResults: 0, rawSnapshotsInserted: 0, rawSnapshotsDuplicate: 0, uniqueProviderItems: 0, normalizedItems: 0, attributableResults: 0, rootAttributions: 0, independentRoots: 0, newRootAttributions: 0, firstSeenRoots: 0, newIndependentEvidenceEligibleRoots: 0, repeatedRoots: 0, sameScanDuplicates: 0, evidenceEligibleRoots: 0, evidenceEligibilityKnownRoots: 0, evaluatedRoots: 0, qualifiedRoots: 0, newIndependentQualifiedRoots: 0, signals: 0, newRootRate: null, eligibleRootRate: null, qualifiedRootRate: null };
        bucket.executions += 1;
        bucket.providerResults += Number(row.provider_results);
        bucket.rawSnapshotsDuplicate += Number(row.raw_snapshots_duplicate);
        bucket.rawSnapshotsInserted += Number(row.raw_snapshots_inserted);
        bucket.uniqueProviderItems += Number(row.unique_provider_items);
        bucket.normalizedItems += Number(row.normalized_items);
        bucket.attributableResults += Number(row.attributable_results);
        bucket.rootAttributions += Number(row.unique_roots);
        bucket.independentRoots += Number(row.independent_roots);
        bucket.newRootAttributions += Number(row.new_root_attributions);
        bucket.firstSeenRoots += Number(row.new_independent_roots);
        bucket.newIndependentEvidenceEligibleRoots += Number(row.new_independent_evidence_eligible_roots);
        bucket.repeatedRoots += Number(row.known_root_attributions);
        bucket.sameScanDuplicates += Number(row.duplicate_root_attributions);
        bucket.evidenceEligibleRoots += Number(row.evidence_eligible_roots);
        bucket.evidenceEligibilityKnownRoots += Number(row.evidence_eligibility_known_roots);
        bucket.evaluatedRoots += Number(row.evaluated_roots);
        bucket.qualifiedRoots += Number(row.qualified_roots);
        bucket.newIndependentQualifiedRoots += Number(row.new_independent_qualified_roots);
        bucket.signals += Number(row.signal_roots);
        bucket.newRootRate = bucket.attributableResults > 0 ? bucket.firstSeenRoots / bucket.attributableResults : null;
        bucket.eligibleRootRate = bucket.evidenceEligibilityKnownRoots > 0 ? bucket.evidenceEligibleRoots / bucket.evidenceEligibilityKnownRoots : null;
        bucket.qualifiedRootRate = bucket.evaluatedRoots > 0 ? bucket.qualifiedRoots / bucket.evaluatedRoots : null;
        grouped.set(key, bucket);
        executions += 1;
        providerResults += Number(row.provider_results);
        rawSnapshotsInserted += Number(row.raw_snapshots_inserted);
        rawSnapshotsDuplicate += Number(row.raw_snapshots_duplicate);
        uniqueProviderItems += Number(row.unique_provider_items);
        normalizedItems += Number(row.normalized_items);
        attributableResults += Number(row.attributable_results);
        independentRoots += Number(row.independent_roots);
        newIndependentEvidenceEligibleRoots += Number(row.new_independent_evidence_eligible_roots);
        evidenceEligibleRoots += Number(row.evidence_eligible_roots);
        evidenceEligibilityKnownRoots += Number(row.evidence_eligibility_known_roots);
        evaluatedRoots += Number(row.evaluated_roots);
        qualifiedRoots += Number(row.qualified_roots);
        newIndependentQualifiedRoots += Number(row.new_independent_qualified_roots);
        firstSeenRoots += Number(row.new_independent_roots);
        newRootAttributions += Number(row.new_root_attributions);
        repeatedRoots += Number(row.known_root_attributions);
        sameScanDuplicates += Number(row.duplicate_root_attributions);
        truncated ||= row.history_truncated;
        sources.add(sourceKey);
        families.add(intentFamily);
        if (!latestExecutionAt || row.completed_at > latestExecutionAt) latestExecutionAt = row.completed_at;
      }
      return {
        rangeStart: queryNoveltyStart,
        rangeEnd: checkedAt.toISOString(),
        providerResults,
        rawSnapshotsInserted,
        rawSnapshotsDuplicate,
        uniqueProviderItems,
        normalizedItems,
        attributableResults,
        independentRoots,
        executions,
        sources: [...sources].sort(),
        intentFamilies: [...families].sort(),
        firstSeenRoots,
        newIndependentEvidenceEligibleRoots,
        newRootAttributions,
        repeatedRoots,
        sameScanDuplicates,
        evidenceEligibleRoots,
        evidenceEligibilityKnownRoots,
        evaluatedRoots,
        qualifiedRoots,
        newIndependentQualifiedRoots,
        newRootRate: attributableResults > 0 ? firstSeenRoots / attributableResults : null,
        eligibleRootRate: evidenceEligibilityKnownRoots > 0 ? evidenceEligibleRoots / evidenceEligibilityKnownRoots : null,
        qualifiedRootRate: evaluatedRoots > 0 ? qualifiedRoots / evaluatedRoots : null,
        truncated,
        buckets: [...grouped.values()].sort((left, right) => right.executions - left.executions || left.sourceKey.localeCompare(right.sourceKey) || left.intentFamily.localeCompare(right.intentFamily)).slice(0, 80),
        latestExecutionAt,
      };
    })();
  const hasDataError = Boolean(jobCount.error || recentJobs.error || healthRows.error || controlRows.error || stuckRows.error || stuckCount.error || monitoringRows.error || signalRows.error || (telemetryEnabled && (executionRows.error || pageRows.error || queryRows.error || resultRows.error || outcomeRows.error || explorationScanRows.error)));
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
    queryNovelty: { value: queryNoveltyValue, source: telemetryEnabled ? "Supabase · signal_query_novelty_history RPC · trailing 7 days · bounded recent scans" : "Server configuration · source execution observability disabled" },
    queryExplorationState: !telemetryEnabled ? "disabled" : explorationScanRows.error ? "unavailable" : latestExploration ? "available" : "empty",
    queryExploration: { value: latestExploration, source: telemetryEnabled ? "Supabase · completed product-demand-scan result · latest 7 days · count-only projection" : "Server configuration · source execution observability disabled" },
    signalLifecycle: { value: signalLifecycleValue, source: "Supabase · signals · all time" },
    evaluationBacklog: { value: backlogValue, source: "Supabase · evaluation_backlog_summary · current state / trailing 24 hours" },
    lastSuccessAt: successfulJobs.error ? null : successfulJobs.data?.completed_at ?? null,
    trigger,
  };
}
