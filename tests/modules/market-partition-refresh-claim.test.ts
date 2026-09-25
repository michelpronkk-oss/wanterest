import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Regression coverage for the Stage 2C production defect where
 * claim_market_partition_refresh returned an empty composite row (every
 * field null) for an unclaimable partition. PostgREST serializes that as an
 * object, not JSON null, so the service treated it as a successful claim and
 * called the provider without a lease. These tests exercise the real
 * repository parsing instead of mocking claim() to return null.
 */

const PARTITION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PARTITION_ID = "44444444-4444-4444-8444-444444444444";

const EMPTY_COMPOSITE = {
  partition_id: null,
  source_key: null,
  enabled: null,
  disabled_reason: null,
  next_due_at: null,
  lease_token: null,
  lease_expires_at: null,
  last_attempt_at: null,
  last_success_at: null,
  last_failure_at: null,
  consecutive_failures: null,
  last_job_run_id: null,
  created_at: null,
  updated_at: null,
};

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    partition_id: PARTITION_ID,
    source_key: "github",
    enabled: true,
    disabled_reason: null,
    next_due_at: "2026-01-01T00:00:00.000Z",
    lease_token: "lease-1",
    lease_expires_at: "2026-01-01T00:30:00.000Z",
    last_attempt_at: "2026-01-01T00:00:00.000Z",
    last_success_at: null,
    last_failure_at: null,
    consecutive_failures: 0,
    last_job_run_id: null,
    ...overrides,
  };
}

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn(async () => rpcResult);

const { MarketPartitionRefreshRepository } = await import("../../src/server/modules/ingestion/market-partition-refresh.repository");

describe("MarketPartitionRefreshRepository.claim", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  function repository() {
    return new MarketPartitionRefreshRepository({ rpc, from: () => { throw new Error("claim must not read tables"); } });
  }

  it("returns null when the RPC returns null", async () => {
    rpcResult = { data: null, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("claim_market_partition_refresh", { p_partition_id: PARTITION_ID, p_lease_token: "lease-1", p_now: "2026-01-01T00:00:00.000Z", p_lease_seconds: 1800 });
  });

  it("returns null when the RPC returns undefined", async () => {
    rpcResult = { data: undefined, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toBeNull();
  });

  it("returns null when the RPC returns an all-null composite row", async () => {
    rpcResult = { data: { ...EMPTY_COMPOSITE }, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toBeNull();
  });

  it("returns null when partition_id is missing or empty", async () => {
    rpcResult = { data: { source_key: "github", enabled: true }, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toBeNull();
    rpcResult = { data: { ...EMPTY_COMPOSITE, partition_id: "" }, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toBeNull();
  });

  it("returns the claimed row when the RPC actually claimed the partition", async () => {
    const row = claimedRow();
    rpcResult = { data: row, error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).resolves.toEqual(row);
  });

  it("throws an invariant error when the RPC claims a different partition", async () => {
    rpcResult = { data: claimedRow({ partition_id: OTHER_PARTITION_ID }), error: null };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).rejects.toThrow(/claim invariant violated/);
  });

  it("surfaces RPC errors as persistence errors", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "service_role_required" } };
    await expect(repository().claim(PARTITION_ID, "lease-1", "2026-01-01T00:00:00.000Z")).rejects.toThrow(/during claim \(42501\)/);
  });
});

describe("refreshMarketPartition with a not-due partition and an empty composite claim", () => {
  it("skips as not_claimable without partition lookup, job creation, or provider execution", async () => {
    vi.resetModules();
    const tablesRead: string[] = [];
    const jobInserts: unknown[] = [];
    const futureState = claimedRow({ next_due_at: "2999-01-01T00:00:00.000Z", lease_token: null, lease_expires_at: null, last_job_run_id: "11111111-1111-4111-8111-111111111111" });
    const notDueRpc = vi.fn(async () => ({ data: { ...EMPTY_COMPOSITE }, error: null }));
    const client = {
      rpc: notDueRpc,
      from(table: string) {
        tablesRead.push(table);
        const filters: Record<string, unknown> = {};
        const builder = {
          select: () => builder,
          eq: (field: string, value: unknown) => { filters[field] = value; return builder; },
          maybeSingle: async () => {
            if (table === "market_partition_refresh_state") return { data: filters.partition_id === PARTITION_ID ? futureState : null, error: null };
            if (table === "job_runs") return { data: null, error: null };
            throw new Error(`unexpected read of ${table}`);
          },
          insert: (row: unknown) => { jobInserts.push(row); throw new Error("refresh job must not be created"); },
          update: () => { throw new Error("state/job must not be updated"); },
        };
        return builder;
      },
    };
    const ingestPublicPartition = vi.fn();
    vi.doMock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => client }));
    vi.doMock("@/server/modules/ingestion/public-ingestion.service", () => ({ ingestPublicPartition }));
    const { refreshMarketPartition } = await import("../../src/server/modules/ingestion/market-partition-refresh.service");

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "replay" });

    expect(result).toMatchObject({ status: "skipped", reason: "not_claimable", jobRunId: null, rawItems: 0 });
    expect(notDueRpc).toHaveBeenCalledTimes(1);
    expect(ingestPublicPartition).not.toHaveBeenCalled();
    expect(jobInserts).toHaveLength(0);
    expect(tablesRead).not.toContain("market_partitions");
    vi.doUnmock("@/server/providers/supabase/service");
    vi.doUnmock("@/server/modules/ingestion/public-ingestion.service");
  });
});
