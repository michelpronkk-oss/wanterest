import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { MarketPartitionRefreshRepository } = await import("../../src/server/modules/ingestion/market-partition-refresh.repository");

type Row = Record<string, unknown>;

/** Minimal in-memory query builder covering exactly the operations market-partition-refresh.repository.ts issues. */
function makeTable(rows: Row[]) {
  return {
    select() {
      let filtered = [...rows];
      let orderField: string | null = null;
      const builder = {
        eq(field: string, value: unknown) { filtered = filtered.filter((row) => row[field] === value); return builder; },
        lte(field: string, value: unknown) { filtered = filtered.filter((row) => (row[field] as string) <= (value as string)); return builder; },
        gte(field: string, value: unknown) { filtered = filtered.filter((row) => (row[field] as string) >= (value as string)); return builder; },
        in(field: string, values: unknown[]) { filtered = filtered.filter((row) => values.includes(row[field])); return builder; },
        or(clause: string) {
          // Supports exactly the clause shape this repository emits: "lease_expires_at.is.null,lease_expires_at.lte.<now>"
          const [isNullPart, ltePart] = clause.split(",");
          const now = ltePart.split(".lte.")[1];
          filtered = filtered.filter((row) => {
            const value = row.lease_expires_at as string | null;
            return (isNullPart.endsWith(".is.null") && value === null) || (value !== null && value <= now);
          });
          return builder;
        },
        order(field: string, options: { ascending: boolean }) { orderField = field; filtered.sort((a, b) => { const cmp = (a[field] as string).localeCompare(b[field] as string); return options.ascending ? cmp : -cmp; }); return builder; },
        async limit(count: number) { void orderField; return { data: filtered.slice(0, count), error: null }; },
        async maybeSingle() { return { data: filtered[0] ?? null, error: null }; },
      };
      return builder;
    },
  };
}

let stateRows: Row[];
let partitionRows: Row[];
let yieldRows: Row[];

function fakeClient() {
  return {
    from(table: string) {
      if (table === "market_partition_refresh_state") return makeTable(stateRows);
      if (table === "market_partitions") return makeTable(partitionRows);
      if (table === "query_yield_artifacts") return makeTable(yieldRows);
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const NOW = "2026-01-15T12:00:00.000Z";

function partitionState(id: string, overrides: Partial<Row> = {}): Row {
  return { partition_id: id, source_key: "github", enabled: true, next_due_at: "2026-01-10T00:00:00.000Z", lease_expires_at: null, ...overrides };
}

describe("MarketPartitionRefreshRepository.listDuePartitions", () => {
  beforeEach(() => {
    stateRows = [];
    partitionRows = [];
    yieldRows = [];
  });

  it("requires recent (14d) product-scan interest to be selectable", async () => {
    stateRows = [partitionState("p1")];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = []; // no interest at all
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([]);
  });

  it("selects a due partition with interest inside the 14-day window", async () => {
    stateRows = [partitionState("p1")];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [{ market_partition_key: "key-1", created_at: "2026-01-10T00:00:00.000Z" }];
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([{ partitionId: "p1", sourceKey: "github", partitionKey: "key-1", nextDueAt: "2026-01-10T00:00:00.000Z" }]);
  });

  it("excludes a partition a product scan fetched within the last 24 hours, even with older interest present", async () => {
    stateRows = [partitionState("p1")];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [
      { market_partition_key: "key-1", created_at: "2026-01-05T00:00:00.000Z" }, // satisfies 14d interest
      { market_partition_key: "key-1", created_at: "2026-01-15T06:00:00.000Z" }, // within last 24h -> exclude
    ];
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([]);
  });

  it("becomes eligible again once the recent product-scan window (24h) has elapsed", async () => {
    stateRows = [partitionState("p1")];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [{ market_partition_key: "key-1", created_at: "2026-01-14T11:00:00.000Z" }]; // 25h before NOW: outside 24h, inside 14d
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toHaveLength(1);
  });

  it("never selects a state row that is not yet due", async () => {
    stateRows = [partitionState("p1", { next_due_at: "2026-02-01T00:00:00.000Z" })];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [{ market_partition_key: "key-1", created_at: "2026-01-10T00:00:00.000Z" }];
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([]);
  });

  it("never selects a disabled state row", async () => {
    stateRows = [partitionState("p1", { enabled: false })];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [{ market_partition_key: "key-1", created_at: "2026-01-10T00:00:00.000Z" }];
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([]);
  });

  it("never selects a partition under a live lease", async () => {
    stateRows = [partitionState("p1", { lease_expires_at: "2026-01-15T13:00:00.000Z" })];
    partitionRows = [{ id: "p1", partition_key: "key-1" }];
    yieldRows = [{ market_partition_key: "key-1", created_at: "2026-01-10T00:00:00.000Z" }];
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toEqual([]);
  });

  it("respects the batch limit", async () => {
    stateRows = Array.from({ length: 8 }, (_, index) => partitionState(`p${index}`, { next_due_at: `2026-01-0${index + 1}T00:00:00.000Z` }));
    partitionRows = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, partition_key: `key-${index}` }));
    yieldRows = Array.from({ length: 8 }, (_, index) => ({ market_partition_key: `key-${index}`, created_at: "2026-01-10T00:00:00.000Z" }));
    const repository = new MarketPartitionRefreshRepository(fakeClient());
    const due = await repository.listDuePartitions(NOW, 5);
    expect(due).toHaveLength(5);
  });
});
