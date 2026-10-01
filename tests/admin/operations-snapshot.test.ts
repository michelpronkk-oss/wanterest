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
      "source_query_result_attributions:id,page_id,conversation_id": { data: [{ id: "attr-1", page_id: "page-1", conversation_id: "conv-1" }, { id: "attr-2", page_id: "page-1", conversation_id: "conv-1" }, { id: "attr-3", page_id: "page-1", conversation_id: "conv-2" }], error: null },
      "product_query_result_outcomes:source_query_result_attribution_id,conversation_id,qualification_status,created_at": { data: [{ source_query_result_attribution_id: "attr-1", conversation_id: "conv-1", qualification_status: "qualified", created_at: week }], error: null },
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
