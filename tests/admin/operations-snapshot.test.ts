import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn() }));
vi.mock("../../apps/admin/src/server/trigger-runs", () => ({ getTriggerRunsSnapshot: vi.fn(async () => ({ state: "unavailable", checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" })) }));

import { createAdminServiceClient } from "../../apps/admin/src/server/supabase";

function queryFor(table: string, responses: Record<string, unknown>) {
  let projection = "";
  let countProjection = false;
  const query = {
    select(value?: string, options?: { count?: string; head?: boolean }) { projection = value ?? ""; countProjection = options?.count === "exact" && options.head === true; return query; },
    eq() { return query; },
    gte() { return query; },
    lt() { return query; },
    in() { return query; },
    not() { return query; },
    order() { return query; },
    limit() { return query; },
    maybeSingle() { return Promise.resolve(responses[`${table}:maybe:${projection}`] ?? { data: null, error: null }); },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(responses[`${table}:${countProjection ? "count:" : ""}${projection}`] ?? responses[`${table}:${projection}`] ?? { data: [], error: null }).then(resolve, reject);
    },
  };
  return query;
}

describe("admin operations snapshot", () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("shows an empty backlog as measured zero and unavailable as unknown", async () => {
    const from = (table: string) => queryFor(table, {});
    const rpc = vi.fn(async () => ({ data: { enqueued: 0, pending: 0, processing: 0, succeeded: 0, skipped: 0, failed: 0,
      exhausted: 0, oldest_pending_at: null, evaluated_24h: 0, qualified_24h: 0, evaluated_hour: 0,
      qualified_hour: 0, average_wait_seconds: null, average_attempts: null }, error: null }));
    vi.mocked(createAdminServiceClient).mockReturnValue({ from, rpc } as never);
    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    expect((await getOperationsSnapshot()).evaluationBacklog.value).toMatchObject({ pending: 0, qualified24h: 0 });
    expect(rpc).toHaveBeenCalledWith("evaluation_backlog_summary");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42P01" } } as never);
    expect((await getOperationsSnapshot()).evaluationBacklog.value).toBeNull();
  });

  it("keeps disabled sources distinct and marks stale health unknown", async () => {
    const now = Date.now();
    const responses = {
      "job_runs:count:id": { count: 1, data: null, error: null },
      "job_runs:id,status,job_type,created_at,trace_id,attempt_count,error_code": { data: [{ id: "run-1", status: "failed", job_type: "match-refreshed-partition", created_at: new Date(now).toISOString(), trace_id: "trace-1", attempt_count: 2, error_code: "42P10" }], error: null },
      "job_runs:maybe:completed_at": { data: { completed_at: new Date(now - 60_000).toISOString() }, error: null },
      "source_health:source_key,degradation_state,updated_at,last_success_at,last_failure_at,last_latency_ms,latest_error_code": { data: [
        { source_key: "fresh", degradation_state: "healthy", updated_at: new Date(now).toISOString() },
        { source_key: "stale", degradation_state: "degraded", updated_at: new Date(now - 48 * 60 * 60 * 1000).toISOString() },
      ], error: null },
      "source_controls:source_key,state,updated_at,failure_count,next_retry_at": { data: [{ source_key: "reddit", state: "disabled", updated_at: new Date(now).toISOString(), failure_count: 2, next_retry_at: null }], error: null },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses) } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();

    expect(result.state).toBe("degraded");
    expect(result.recentJobs.value?.[0]?.status).toBe("failed");
    expect(result.sourceRows.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: "fresh", state: "healthy" }),
      expect.objectContaining({ sourceKey: "stale", state: "stale" }),
      expect.objectContaining({ sourceKey: "reddit", state: "disabled" }),
    ]));
    expect(result.description).toContain("unavailable");
  });

  it("returns unavailable instead of zero when service credentials are missing", async () => {
    vi.mocked(createAdminServiceClient).mockReturnValue(null);
    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();
    expect(result.jobs.value).toBeNull();
    expect(result.sources.value).toBeNull();
    expect(result.state).toBe("unknown");
  });

  it("keeps the new telemetry read and write surface disabled by default", async () => {
    const from = vi.fn((table: string) => queryFor(table, {}));
    vi.mocked(createAdminServiceClient).mockReturnValue({ from } as never);
    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();
    expect(result.pipelineState).toBe("disabled");
    expect(result.pipeline.value).toBeNull();
    expect(from.mock.calls.map(([table]) => table)).not.toEqual(expect.arrayContaining([
      "source_query_executions", "source_query_execution_pages", "source_query_result_attributions", "product_query_result_outcomes",
    ]));
  });

  it("aggregates provider execution, page, root and qualification attribution from persisted rows", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const now = Date.now();
    const week = new Date(now - 86_400_000).toISOString();
    const responses = {
      "job_runs:count:id": { count: 1, data: null, error: null },
      "job_runs:id,status,job_type,created_at,trace_id,attempt_count,error_code": { data: [], error: null },
      "job_runs:maybe:completed_at": { data: null, error: null },
      "job_runs:id,job_type,created_at,started_at,attempt_count,error_code": { data: [{ id: "stuck-1", job_type: "match-partition-incremental", created_at: week, started_at: week, attempt_count: 2, error_code: null }], error: null },
      "source_health:source_key,degradation_state,updated_at,last_success_at,last_failure_at,last_latency_ms,latest_error_code": { data: [], error: null },
      "source_controls:source_key,state,updated_at,failure_count,next_retry_at": { data: [], error: null },
      "monitoring_schedules:enabled,current_status,last_cycle_at,last_success_at,last_failure_at": { data: [{ enabled: false, current_status: "paused", last_cycle_at: week, last_success_at: null, last_failure_at: null }], error: null },
      "source_query_executions:id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at": { data: [
        { id: "exec-1", source_key: "github", execution_status: "completed_with_results", provider_results_returned: 4, raw_snapshots_inserted: 3, continuation_count: 1, duration_ms: 200, created_at: week },
        { id: "exec-2", source_key: "x", execution_status: "rate_limited", provider_results_returned: 0, raw_snapshots_inserted: 0, continuation_count: 0, duration_ms: 100, created_at: week },
      ], error: null },
      "source_query_execution_pages:id,execution_id,attempt_count,continuation_followed,duration_ms,rate_limit_remaining,retry_after_ms": { data: [
        { id: "page-1", execution_id: "exec-1", attempt_count: 2, continuation_followed: true, duration_ms: 100, rate_limit_remaining: 4, retry_after_ms: 1250 },
        { id: "page-2", execution_id: "exec-2", attempt_count: 2, continuation_followed: false, duration_ms: 100, rate_limit_remaining: 0, retry_after_ms: 30000 },
      ], error: null },
      "query_yield_artifacts:source_key,execution_status": { data: [{ source_key: "github", execution_status: "completed_with_results" }, { source_key: "github", execution_status: "disabled" }], error: null },
      "source_query_result_attributions:id,page_id,conversation_id,first_root_in_execution": { data: [{ id: "attr-1", page_id: "page-1", conversation_id: "conv-1", first_root_in_execution: true }, { id: "attr-2", page_id: "page-1", conversation_id: "conv-1", first_root_in_execution: false }, { id: "attr-3", page_id: "page-1", conversation_id: "conv-2", first_root_in_execution: true }], error: null },
      "product_query_result_outcomes:source_query_result_attribution_id,conversation_id,workspace_id,product_id,qualification_status,evidence_eligible,created_at": { data: [{ source_query_result_attribution_id: "attr-1", conversation_id: "conv-1", qualification_status: "qualified", evidence_eligible: true, workspace_id: "ws", product_id: "product", created_at: week }], error: null },
      "signals:lifecycle_status": { data: [{ lifecycle_status: "invalidated" }, { lifecycle_status: "archived" }], error: null },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses) } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();

    expect(result.pipeline.value?.providers).toEqual([expect.objectContaining({
      sourceKey: "github", plannedQueries: 2, executedQueries: 1, executions: 1, successful: 1, failed: 0, skippedQueries: 1,
      providerResults: 4, rawSnapshotsInserted: 3, uniqueRoots: 2, duplicateRoots: 1, qualifiedRoots: 1,
      pages: 1, continuations: 1, retries: 1, lowestRateLimitRemaining: 4, longestRetryAfterHintMs: 1250, averageRuntimeMs: 200,
    }), expect.objectContaining({
      sourceKey: "x", executions: 1, successful: 0, failed: 1, rateLimitedExecutions: 1, pages: 1, retries: 1,
      lowestRateLimitRemaining: 0, longestRetryAfterHintMs: 30000, averageRuntimeMs: 100,
    })]);
    expect(result.pipeline.value).toMatchObject({ roots: 2, qualifiedRoots: 1 });
    expect(result.stuckJobs.value).toHaveLength(1);
    expect(result.monitoring.value).toMatchObject({ enabledSchedules: 0, disabledSchedules: 1, statusCounts: { paused: 1 } });
    expect(result.signalLifecycle.value).toMatchObject({ archived: 1, invalidated: 1, active: 0 });
  });

  it("projects private Pagination V1 request, novelty, root and known-eligibility counts only", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const week = new Date(Date.now() - 60_000).toISOString();
    const responses = {
      "source_query_executions:id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at": { data: [{ id: "exec-hn", source_key: "hacker-news", created_at: week, query_plan_fingerprint: "private-fingerprint-marker" }], error: null },
      "source_query_execution_pages:id,execution_id,attempt_count,continuation_followed,duration_ms,rate_limit_remaining,retry_after_ms": { data: [
        { id: "page-hn-1", execution_id: "exec-hn", attempt_count: 1, continuation_followed: true },
        { id: "page-hn-2", execution_id: "exec-hn", attempt_count: 1, continuation_followed: false },
      ], error: null },
      "source_query_execution_pages:id,execution_id,page_number,provider_results_returned,raw_snapshots_accepted,raw_snapshots_inserted,raw_snapshots_duplicate,unique_provider_items,duplicate_provider_items,unique_roots,duplicate_roots,cursor_requested,pagination_policy_version,continuation_eligible,continuation_reason,continuation_attempted,continuation_status": { data: [
        { id: "page-hn-1", execution_id: "exec-hn", page_number: 1, provider_results_returned: 2, raw_snapshots_accepted: 2, raw_snapshots_inserted: 2, raw_snapshots_duplicate: 0, unique_provider_items: 2, duplicate_provider_items: 0, unique_roots: 2, duplicate_roots: 0, cursor_requested: false, pagination_policy_version: "signal_pagination_depth_v1", continuation_eligible: true, continuation_reason: "eligible_high_novelty", continuation_attempted: true, continuation_status: "received" },
        { id: "page-hn-2", execution_id: "exec-hn", page_number: 2, provider_results_returned: 3, raw_snapshots_accepted: 3, raw_snapshots_inserted: 2, raw_snapshots_duplicate: 1, unique_provider_items: 2, duplicate_provider_items: 1, unique_roots: 1, duplicate_roots: 2, cursor_requested: true, pagination_policy_version: "signal_pagination_depth_v1", continuation_eligible: null, continuation_reason: null, continuation_attempted: false, continuation_status: null },
      ], error: null },
      "source_query_result_attributions:id,page_id,conversation_id,first_root_in_execution": { data: [
        { id: "attr-new", page_id: "page-hn-2", conversation_id: "conv-new", first_root_in_execution: true },
        { id: "attr-repeat", page_id: "page-hn-2", conversation_id: "conv-old", first_root_in_execution: false },
      ], error: null },
      "product_query_result_outcomes:source_query_result_attribution_id,conversation_id,workspace_id,product_id,qualification_status,evidence_eligible,created_at": { data: [
        { source_query_result_attribution_id: "attr-new", conversation_id: "conv-new", workspace_id: "ws", product_id: "prod", evidence_eligible: true, created_at: week },
        { source_query_result_attribution_id: "attr-repeat", conversation_id: "conv-old", workspace_id: "ws", product_id: "prod", evidence_eligible: null, created_at: week },
      ], error: null },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses) } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();

    expect(result.paginationState).toBe("available");
    expect(result.pagination.value).toMatchObject({
      baseRequests: 1, eligible: 1, attempted: 1, continuationRequests: 1, failures: 0,
      results: 3, uniqueProviderItems: 2, duplicateProviderItems: 1, inserted: 2, reused: 1,
      independentRoots: 1, firstSeenRootsInExecution: 1, repeatedRootAttributions: 2,
      evidenceEligibleRoots: 1, firstSeenEvidenceEligibleRoots: 1, evidenceEligibilityKnownRoots: 1,
      decisionReasons: [{ reason: "eligible_high_novelty", count: 1 }], continuationStatuses: { received: 1 },
      providers: [expect.objectContaining({ sourceKey: "hacker-news", uniqueProviderItems: 2, independentRoots: 1 })],
    });
    expect(JSON.stringify(result.pagination.value)).not.toContain("private-fingerprint-marker");
  });

  it("keeps existing Operations data readable when the forward pagination columns are not deployed", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const responses = {
      "source_query_execution_pages:id,execution_id,page_number,provider_results_returned,raw_snapshots_accepted,raw_snapshots_inserted,raw_snapshots_duplicate,unique_provider_items,duplicate_provider_items,unique_roots,duplicate_roots,cursor_requested,pagination_policy_version,continuation_eligible,continuation_reason,continuation_attempted,continuation_status": { data: null, error: { code: "42703" } },
      "source_query_executions:id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at": { data: [], error: null },
      "source_query_execution_pages:id,execution_id,attempt_count,continuation_followed,duration_ms,rate_limit_remaining,retry_after_ms": { data: [], error: null },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses) } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();

    expect(result.paginationState).toBe("unavailable");
    expect(result.pagination.value).toBeNull();
    expect(result.pipelineState).toBe("available");
  });

  it("aggregates only private novelty dimensions and never returns fingerprints", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const now = new Date().toISOString();
    const rpc = vi.fn(async (name: string) => name === "signal_query_novelty_history"
      ? { data: [{ execution_id: "exec-private", scan_job_run_id: "run-private", source_key: "github", query_family: "feature_requirement", intent_family: "missing_integration", query_variant_version: "signal_query_exploration_v1_1", selection_reason: "unseen_variant_exploration", novelty_state: "cold_start", query_plan_fingerprint: "a".repeat(64), execution_status: "completed_with_results", provider_results: 4, raw_snapshots_inserted: 3, raw_snapshots_duplicate: 1, unique_provider_items: 3, normalized_items: 2, attributable_results: 3, unique_roots: 2, independent_roots: 2, new_root_attributions: 1, new_independent_roots: 1, known_root_attributions: 1, duplicate_root_attributions: 0, evidence_eligible_roots: 1, new_independent_evidence_eligible_roots: 1, evidence_eligibility_known_roots: 2, evaluated_roots: 1, qualified_roots: 0, new_independent_qualified_roots: 0, signal_roots: 0, history_truncated: true, completed_at: now }], error: null }
      : { data: { enqueued: 0, pending: 0, processing: 0, succeeded: 0, skipped: 0, failed: 0, exhausted: 0, oldest_pending_at: null, evaluated_24h: 0, qualified_24h: 0, evaluated_hour: 0, qualified_hour: 0, average_wait_seconds: null, average_attempts: null }, error: null });
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, {}), rpc } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();
    expect(result.queryNovelty.value).toMatchObject({ executions: 1, firstSeenRoots: 1, newIndependentEvidenceEligibleRoots: 1, independentRoots: 2, newRootAttributions: 1, repeatedRoots: 1, sameScanDuplicates: 0, attributableResults: 3, newRootRate: 1 / 3, eligibleRootRate: 1 / 2, qualifiedRootRate: 0, newIndependentQualifiedRoots: 0 });
    expect(result.queryNovelty.value?.truncated).toBe(true);
    expect(result.queryNovelty.value?.buckets[0]).toMatchObject({ sourceKey: "github", intentFamily: "missing_integration", variantVersion: "signal_query_exploration_v1_1", selectionReason: "unseen_variant_exploration", noveltyState: "cold_start", providerResults: 4, rawSnapshotsInserted: 3, rawSnapshotsDuplicate: 1, uniqueProviderItems: 3, normalizedItems: 2, attributableResults: 3, rootAttributions: 2, independentRoots: 2, newRootRate: 1 / 3, eligibleRootRate: 1 / 2, qualifiedRootRate: 0, evidenceEligibleRoots: 1, newIndependentEvidenceEligibleRoots: 1, evidenceEligibilityKnownRoots: 2, newIndependentQualifiedRoots: 0 });
    expect(JSON.stringify(result.queryNovelty.value)).not.toContain("query_plan_fingerprint");
    expect(JSON.stringify(result.queryNovelty.value)).not.toContain("exec-private");
    expect(rpc).toHaveBeenCalledWith("signal_query_novelty_history", expect.objectContaining({ p_workspace_id: null, p_product_id: null, p_max_scans: 12 }));
  });

  it("projects V1.1 planner diagnostics as bounded counts without returning scan query details", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const now = new Date().toISOString();
    const privateScanResult = {
      finalQueries: [{ id: "private-query-id", query_text: "private search text" }],
      queryPlanning: { signalQueryExplorationV11: {
        historyState: "available", queryCountBefore: 14, queryCountAfter: 14, candidateCount: 46, unselectedCandidateCount: 32,
        recentlyExecutedCandidateCount: 14, previouslyExecutedCandidateCount: 14, unseenCandidateCount: 32, rotatedSelectionCount: 11,
        immediatelyRepeatedCandidateCount: 3, immediatelyRepeatedSelectionCount: 0,
        persistentLowNoveltyCandidateCount: 0, recentZeroNoveltyCandidateCount: 2,
        selectedReasonCounts: { recency_rotation: 9, recent_zero_novelty_rotation: 2, default_rank: 3 },
        noveltyStateCounts: { cold_start: 32, insufficient_history: 14 },
        candidatePoolBySource: { github: { validCandidates: 7, selected: 3, unselected: 4 } },
        familyCoverageBySource: { github: 3 },
        familyCoverageHistoryBySource: { github: { zeroScansCandidates: 4, oneScanCandidates: 2, twoScansCandidates: 1, threeScansCandidates: 0 } },
      } },
    };
    const responses = {
      "job_runs:completed_at,exploration:input_reference->result->queryPlanning->signalQueryExplorationV11": { data: [{ completed_at: now, exploration: { ...privateScanResult.queryPlanning.signalQueryExplorationV11, query_id: "private-query-id", query_text: "private search text" } }], error: null },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses), rpc: vi.fn(async () => ({ data: [], error: null })) } as never);

    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();
    expect(result.queryExplorationState).toBe("available");
    expect(result.queryExploration.value).toMatchObject({
      candidateCount: 46, unselectedCandidateCount: 32, recentlyExecutedCandidateCount: 14, previouslyExecutedCandidateCount: 14, unseenCandidateCount: 32,
      rotatedSelectionCount: 11, immediatelyRepeatedCandidateCount: 3, immediatelyRepeatedSelectionCount: 0,
      recentZeroNoveltyCandidateCount: 2,
      candidatePoolBySource: [{ sourceKey: "github", validCandidates: 7, selected: 3, unselected: 4 }],
      familyCoverageHistoryBySource: [{ sourceKey: "github", zeroScansCandidates: 4, oneScanCandidates: 2, twoScansCandidates: 1, threeScansCandidates: 0 }],
      noveltyStateCounts: [{ state: "cold_start", count: 32 }, { state: "insufficient_history", count: 14 }],
    });
    const serialized = JSON.stringify(result.queryExploration.value);
    expect(serialized).not.toContain("private-query-id");
    expect(serialized).not.toContain("private search text");
    expect(serialized).not.toContain("query_text");
  });

  it("marks the attribution read unavailable when new telemetry tables cannot be read", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    const responses = {
      "job_runs:count:id": { count: 0, data: null, error: null },
      "source_query_executions:id,source_key,execution_status,provider_results_returned,raw_snapshots_inserted,continuation_count,duration_ms,created_at": { data: null, error: { code: "42P01" } },
    };
    vi.mocked(createAdminServiceClient).mockReturnValue({ from: (table: string) => queryFor(table, responses) } as never);
    const { getOperationsSnapshot } = await import("../../apps/admin/src/server/operations");
    const result = await getOperationsSnapshot();
    expect(result.pipeline.value).toBeNull();
    expect(result.databaseRead).toBe(false);
  });
});
