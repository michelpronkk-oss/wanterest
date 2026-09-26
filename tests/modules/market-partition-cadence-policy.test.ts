import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const policy = await import("../../src/server/modules/ingestion/market-partition-refresh.policy");
const { adaptiveMarketPartitionCadence, remainingDailyRefreshBudget, MARKET_PARTITION_CADENCE_BY_SOURCE, MARKET_PARTITION_REFRESH_DAILY_CAP } = policy;
const H = 3600_000;

describe("adaptive market-partition cadence v2 (Stage 2F)", () => {
  it("is versioned and keeps X and YouTube out of automatic refresh", () => {
    expect(policy.MARKET_PARTITION_CADENCE_POLICY_VERSION).toBe("market_partition_cadence_v2");
    expect(Object.keys(MARKET_PARTITION_CADENCE_BY_SOURCE).sort()).toEqual(["github", "hacker-news", "stack-exchange"]);
    expect(Object.keys(MARKET_PARTITION_REFRESH_DAILY_CAP).sort()).toEqual(["github", "hacker-news", "stack-exchange"]);
    expect(policy.isMarketPartitionRefreshSource("x")).toBe(false);
    expect(policy.isMarketPartitionRefreshSource("youtube")).toBe(false);
  });

  it("refreshes productive partitions faster, bounded by the source minimum", () => {
    expect(adaptiveMarketPartitionCadence({ sourceKey: "github", rawItems: 10, rawNewItems: 6, consecutiveZeroNewBefore: 3, distinctInterestCount: 1 })).toMatchObject({ cadenceMs: 6 * H, consecutiveZeroNew: 0, novelty: 0.6, clamped: null });
    expect(adaptiveMarketPartitionCadence({ sourceKey: "github", rawItems: 10, rawNewItems: 6, consecutiveZeroNewBefore: 0, distinctInterestCount: 5 })).toMatchObject({ cadenceMs: 6 * H, clamped: "min" });
    expect(adaptiveMarketPartitionCadence({ sourceKey: "github", rawItems: 10, rawNewItems: 3, consecutiveZeroNewBefore: 0, distinctInterestCount: 1 }).cadenceMs).toBe(9 * H);
    expect(adaptiveMarketPartitionCadence({ sourceKey: "github", rawItems: 10, rawNewItems: 1, consecutiveZeroNewBefore: 0, distinctInterestCount: 1 }).cadenceMs).toBe(12 * H);
  });

  it("backs off exponentially on consecutive zero-new refreshes, bounded by the source maximum", () => {
    const steps = [0, 1, 2, 3, 4, 10].map((before) => adaptiveMarketPartitionCadence({ sourceKey: "stack-exchange", rawItems: 5, rawNewItems: 0, consecutiveZeroNewBefore: before, distinctInterestCount: 1 }));
    expect(steps.map((step) => step.cadenceMs / H)).toEqual([48, 96, 168, 168, 168, 168]);
    expect(steps.map((step) => step.consecutiveZeroNew)).toEqual([1, 2, 3, 4, 5, 11]);
    expect(steps[2].clamped).toBe("max");
    expect(adaptiveMarketPartitionCadence({ sourceKey: "github", rawItems: 0, rawNewItems: 0, consecutiveZeroNewBefore: 0, distinctInterestCount: 0 }).cadenceMs).toBe(24 * H);
  });

  it("is deterministic and sanitizes impossible inputs", () => {
    const input = { sourceKey: "github" as const, rawItems: 4, rawNewItems: 9, consecutiveZeroNewBefore: -3, distinctInterestCount: 2 };
    expect(adaptiveMarketPartitionCadence(input)).toEqual(adaptiveMarketPartitionCadence(input));
    expect(adaptiveMarketPartitionCadence(input).novelty).toBe(1);
  });

  it("computes the remaining rolling daily budget per source, never negative", () => {
    expect(remainingDailyRefreshBudget({ github: 5, "stack-exchange": 999, x: 50 })).toEqual({ github: MARKET_PARTITION_REFRESH_DAILY_CAP.github - 5, "stack-exchange": 0, "hacker-news": MARKET_PARTITION_REFRESH_DAILY_CAP["hacker-news"] });
  });
});
