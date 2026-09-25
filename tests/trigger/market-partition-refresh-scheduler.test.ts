import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const batchTriggerMock = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (config: { id: string; cron: unknown; run: (payload: { timestamp: Date }) => unknown }) => ({ ...config, run: config.run }) },
  schemaTask: (config: { id: string; queue?: unknown; retry?: unknown; maxDuration?: number; schema: unknown; run: (input: unknown) => unknown }) => ({ ...config, run: config.run, batchTrigger: batchTriggerMock }),
}));

const ensureMarketPartitionRefreshStateMock = vi.fn(async () => ({ ensured: 0 }));
const listDueMarketPartitionRefreshesMock = vi.fn(async () => [] as Array<{ partitionId: string; sourceKey: string; partitionKey: string; nextDueAt: string }>);
const refreshMarketPartitionMock = vi.fn();

vi.mock("@/server/modules/ingestion/market-partition-refresh.service", () => ({
  ensureMarketPartitionRefreshState: ensureMarketPartitionRefreshStateMock,
  listDueMarketPartitionRefreshes: listDueMarketPartitionRefreshesMock,
  refreshMarketPartition: refreshMarketPartitionMock,
}));

let envValue: string | undefined;
vi.mock("@/server/lib/env", () => ({ getServerEnv: () => ({ MARKET_PARTITION_REFRESH_ENABLED: envValue }) }));

const trigger = await import("../../src/trigger/market-partition-refresh");
type RunnableTask = { run: (payload: unknown) => Promise<unknown> };
const marketPartitionRefreshSchedulerTask = trigger.marketPartitionRefreshSchedulerTask as unknown as RunnableTask;
const refreshMarketPartitionTask = trigger.refreshMarketPartitionTask;

describe("market-partition-refresh-scheduler", () => {
  beforeEach(() => {
    envValue = undefined;
    batchTriggerMock.mockReset();
    ensureMarketPartitionRefreshStateMock.mockClear();
    listDueMarketPartitionRefreshesMock.mockClear();
  });

  it("is a no-op with zero DB/Trigger calls when the flag is unset (default off)", async () => {
    const result = await marketPartitionRefreshSchedulerTask.run({ timestamp: new Date("2026-01-01T00:00:00Z") } as never);
    expect(result).toMatchObject({ enabled: false, ensured: 0, due: 0, dispatched: 0 });
    expect(ensureMarketPartitionRefreshStateMock).not.toHaveBeenCalled();
    expect(listDueMarketPartitionRefreshesMock).not.toHaveBeenCalled();
    expect(batchTriggerMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the flag is exactly \"false\"", async () => {
    envValue = "false";
    await marketPartitionRefreshSchedulerTask.run({ timestamp: new Date() } as never);
    expect(ensureMarketPartitionRefreshStateMock).not.toHaveBeenCalled();
  });

  it("ensures state and dispatches due partitions with deterministic idempotency keys when enabled", async () => {
    envValue = "true";
    ensureMarketPartitionRefreshStateMock.mockResolvedValueOnce({ ensured: 2 });
    listDueMarketPartitionRefreshesMock.mockResolvedValueOnce([
      { partitionId: "p1", sourceKey: "github", partitionKey: "key-1", nextDueAt: "2026-01-01T00:00:00.000Z" },
      { partitionId: "p2", sourceKey: "stack-exchange", partitionKey: "key-2", nextDueAt: "2026-01-01T00:05:00.000Z" },
    ]);

    const result = await marketPartitionRefreshSchedulerTask.run({ timestamp: new Date("2026-01-01T01:00:00Z") } as never);

    expect(result).toMatchObject({ enabled: true, ensured: 2, due: 2, dispatched: 2 });
    expect(batchTriggerMock).toHaveBeenCalledTimes(1);
    const items = batchTriggerMock.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0].payload.partitionId).toBe("p1");
    expect(items[0].options.idempotencyKey).toBe("refresh-market-partition:p1:2026-01-01T00:00:00.000Z");
    expect(items[1].options.idempotencyKey).toBe("refresh-market-partition:p2:2026-01-01T00:05:00.000Z");
  });

  it("calls batch selection with the fixed 5-partition-per-tick limit", async () => {
    envValue = "true";
    await marketPartitionRefreshSchedulerTask.run({ timestamp: new Date() } as never);
    expect(listDueMarketPartitionRefreshesMock).toHaveBeenCalledWith(5);
  });

  it("declares the child task with concurrency limit 2 and 2 max attempts", () => {
    expect((refreshMarketPartitionTask as unknown as { queue: { concurrencyLimit: number } }).queue.concurrencyLimit).toBe(2);
    expect((refreshMarketPartitionTask as unknown as { retry: { maxAttempts: number } }).retry.maxAttempts).toBe(2);
  });
});
