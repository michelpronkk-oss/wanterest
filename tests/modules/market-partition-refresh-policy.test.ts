import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES,
  MARKET_PARTITION_REFRESH_SOURCE_KEYS,
  buildMarketPartitionRefreshRequest,
  isMarketPartitionRefreshSource,
  marketPartitionRefreshDeferralAt,
  marketPartitionRefreshFailureBackoffAt,
  marketPartitionRefreshJitterMinutes,
  marketPartitionRefreshNextDueAtAfterSuccess,
} from "../../src/server/modules/ingestion/market-partition-refresh.policy";
import { deriveMarketPartitionIdentity } from "../../src/server/modules/ingestion/market-partition-identity";
import { sourceDiscoveryRequestSchema } from "../../src/server/providers/source/contracts";

function spec(overrides: Partial<{ source_key: string; expression: string; params: Record<string, unknown>; expandThreads: boolean }> = {}) {
  return {
    v: "market_partition_identity_v1" as const,
    source_key: "github",
    expression: "is:issue slow onboarding repo:acme/product",
    params: {},
    expandThreads: false,
    ...overrides,
  };
}

describe("market-partition refresh source allowlist (Stage 2C v1)", () => {
  it("accepts only github and stack-exchange", () => {
    expect(MARKET_PARTITION_REFRESH_SOURCE_KEYS).toEqual(["github", "stack-exchange"]);
    expect(isMarketPartitionRefreshSource("github")).toBe(true);
    expect(isMarketPartitionRefreshSource("stack-exchange")).toBe(true);
  });

  it("rejects x", () => expect(isMarketPartitionRefreshSource("x")).toBe(false));
  it("rejects youtube", () => expect(isMarketPartitionRefreshSource("youtube")).toBe(false));
  it("rejects every other known source", () => {
    for (const sourceKey of ["g2", "hacker-news", "trustpilot", "public-web", "fixture", "reddit", "bluesky", "gitlab", "product-hunt"]) {
      expect(isMarketPartitionRefreshSource(sourceKey), sourceKey).toBe(false);
    }
  });
});

describe("buildMarketPartitionRefreshRequest", () => {
  it("rejects a non-refreshable source without building a request", () => {
    const result = buildMarketPartitionRefreshRequest({ sourceKey: "x", retrievalSpec: spec({ source_key: "x" }) });
    expect(result).toEqual({ ok: false, reason: "source_not_refreshable" });
  });

  it("rejects an empty expression", () => {
    const result = buildMarketPartitionRefreshRequest({ sourceKey: "github", retrievalSpec: spec({ expression: "   " }) });
    expect(result).toEqual({ ok: false, reason: "empty_expression" });
  });

  it("builds a request whose derived partition key round-trips to the stored key for every refreshable source", () => {
    for (const sourceKey of MARKET_PARTITION_REFRESH_SOURCE_KEYS) {
      const retrievalSpec = spec({ source_key: sourceKey, params: sourceKey === "github" ? { repository: "acme/product", contentType: "issues" } : { site: "stackoverflow" } });
      const built = buildMarketPartitionRefreshRequest({ sourceKey, retrievalSpec });
      expect(built.ok, sourceKey).toBe(true);
      if (!built.ok) continue;
      const originalIdentity = deriveMarketPartitionIdentity({ sourceKey, request: sourceDiscoveryRequestSchema.parse({ query: retrievalSpec.expression, expandThreads: retrievalSpec.expandThreads, limit: 25, requestMetadata: retrievalSpec.params }) });
      const rebuiltIdentity = deriveMarketPartitionIdentity({ sourceKey, request: built.request });
      expect(originalIdentity.eligible && rebuiltIdentity.eligible && originalIdentity.partitionKey === rebuiltIdentity.partitionKey, sourceKey).toBe(true);
    }
  });

  it("execution settings (limit, maxPages) never change the round-tripped partition key", () => {
    const retrievalSpec = spec();
    const a = buildMarketPartitionRefreshRequest({ sourceKey: "github", retrievalSpec });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.request.limit).toBe(10);
    expect((a.request.requestMetadata as Record<string, unknown>).maxPages).toBe(1);
    const identity = deriveMarketPartitionIdentity({ sourceKey: "github", request: a.request });
    const originalIdentity = deriveMarketPartitionIdentity({ sourceKey: "github", request: sourceDiscoveryRequestSchema.parse({ query: retrievalSpec.expression, expandThreads: false, limit: 100, requestMetadata: { ...retrievalSpec.params, maxPages: 3 } }) });
    expect(identity.eligible && originalIdentity.eligible && identity.partitionKey === originalIdentity.partitionKey).toBe(true);
  });
});

describe("marketPartitionRefreshJitterMinutes", () => {
  it("is deterministic for the same partition id", () => {
    const a = marketPartitionRefreshJitterMinutes("11111111-1111-4111-8111-111111111111");
    const b = marketPartitionRefreshJitterMinutes("11111111-1111-4111-8111-111111111111");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(60);
  });

  it("differs across partition ids (not a constant)", () => {
    const jitters = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => marketPartitionRefreshJitterMinutes(`${seed}0000000-0000-4000-8000-000000000000`)));
    expect(jitters.size).toBeGreaterThan(1);
  });
});

describe("marketPartitionRefreshNextDueAtAfterSuccess", () => {
  it("advances by exactly 24 hours plus the deterministic jitter", () => {
    const partitionId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";
    const next = marketPartitionRefreshNextDueAtAfterSuccess(partitionId, now);
    const jitterMinutes = marketPartitionRefreshJitterMinutes(partitionId);
    const expected = new Date(Date.parse(now) + 24 * 60 * 60 * 1000 + jitterMinutes * 60_000).toISOString();
    expect(next).toBe(expected);
  });
});

describe("marketPartitionRefreshFailureBackoffAt", () => {
  it("is bounded between 1 hour and 24 hours", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const oneHourLater = marketPartitionRefreshFailureBackoffAt(now, 0);
    expect(Date.parse(oneHourLater) - Date.parse(now)).toBe(1 * 60 * 60 * 1000);
    const capped = marketPartitionRefreshFailureBackoffAt(now, 10);
    expect(Date.parse(capped) - Date.parse(now)).toBe(24 * 60 * 60 * 1000);
  });

  it("grows exponentially between the bounds", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const afterTwo = marketPartitionRefreshFailureBackoffAt(now, 2);
    expect(Date.parse(afterTwo) - Date.parse(now)).toBe(4 * 60 * 60 * 1000);
  });
});

describe("marketPartitionRefreshDeferralAt", () => {
  it("defers by 1 hour without touching the failure backoff formula", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const deferred = marketPartitionRefreshDeferralAt(now);
    expect(Date.parse(deferred) - Date.parse(now)).toBe(60 * 60 * 1000);
  });
});

describe("MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES", () => {
  it("hard-disables after 5 consecutive failures", () => {
    expect(MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES).toBe(5);
  });
});
