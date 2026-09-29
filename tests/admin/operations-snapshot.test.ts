import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../apps/admin/src/server/supabase", () => ({ createAdminServiceClient: vi.fn() }));
vi.mock("../../apps/admin/src/server/trigger-runs", () => ({ getTriggerRunsSnapshot: vi.fn(async () => ({ state: "unavailable", checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" })) }));

import { createAdminServiceClient } from "../../apps/admin/src/server/supabase";

function queryFor(table: string, responses: Record<string, unknown>) {
  let projection = "";
  const query = {
    select(value?: string) { projection = value ?? ""; return query; },
    eq() { return query; },
    gte() { return query; },
    not() { return query; },
    order() { return query; },
    limit() { return query; },
    maybeSingle() { return Promise.resolve(responses[`${table}:maybe:${projection}`] ?? { data: null, error: null }); },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(responses[`${table}:${projection}`] ?? { data: [], error: null }).then(resolve, reject);
    },
  };
  return query;
}

describe("admin operations snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps disabled sources distinct and marks stale health unknown", async () => {
    const now = Date.now();
    const responses = {
      "job_runs:id": { count: 1, data: null, error: null },
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
});
