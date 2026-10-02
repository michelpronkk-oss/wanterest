import { describe, expect, it } from "vitest";

import { marketMemoryHistory } from "../../src/server/modules/ingestion/market-memory-history";
import { publicEvidenceMetadata, requestUsedRetrievalQuery } from "../../src/server/modules/ingestion/public-evidence-boundary";

describe("Market Memory V1 public boundary", () => {
  it("strips private retrieval and tenant context while preserving safe provider identity hints", () => {
    const sanitized = publicEvidenceMetadata({
      provider: "test-provider",
      sourceCategory: "public_discussion",
      query: "private product positioning query",
      queryPlanId: "plan-with-product-slug",
      workspaceId: "workspace-secret",
      internalWorkspaceId: "internal-workspace-secret",
      g2ScanContext: { workspaceId: "workspace-secret", productId: "product-secret" },
      providerCursor: "cursor-secret",
      nested: { providerQuery: "private provider query", safe: "public" },
    });

    expect(sanitized).toEqual({
      provider: "test-provider",
      sourceCategory: "public_discussion",
      retrievalQueryPresent: true,
      nested: { safe: "public" },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/private|secret|cursor|workspace|product/i);
  });

  it("records query presence without persisting query text", () => {
    expect(requestUsedRetrievalQuery({ query: "buyer workflow problem" })).toBe(true);
    expect(requestUsedRetrievalQuery({ requestMetadata: { providerQuery: "compiled provider syntax" } })).toBe(true);
    expect(publicEvidenceMetadata({ query: "buyer workflow problem" })).toEqual({ retrievalQueryPresent: true });
    expect(publicEvidenceMetadata({ provider: "provider", page: 2 })).toEqual({ provider: "provider", page: 2 });
  });

  it("keeps first-seen identity time stable and derives retrieval history from attributed observations", () => {
    const firstSeenAt = "2026-01-02T00:00:00.000Z";
    const history = marketMemoryHistory({
      firstSeenAt,
      observations: [
        { observedAt: "2026-03-01T00:00:00.000Z", executionId: "execution-a", rawSnapshotInserted: true },
        { observedAt: "2026-02-01T00:00:00.000Z", executionId: "execution-a", rawSnapshotInserted: false },
        { observedAt: "2026-04-01T00:00:00.000Z", executionId: "execution-b", rawSnapshotInserted: false },
      ],
    });

    expect(history).toEqual({
      firstSeenAt,
      firstRetrievedAt: "2026-02-01T00:00:00.000Z",
      lastRetrievedAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      retrievalCount: 3,
      distinctExecutionCount: 2,
      rawSnapshotReuseCount: 2,
      coverage: "observed",
    });
  });

  it("reports history as unavailable or partial instead of inventing zeroes", () => {
    const unavailable = marketMemoryHistory({ firstSeenAt: "2026-01-02T00:00:00.000Z", observations: null });
    expect(unavailable).toMatchObject({ retrievalCount: null, rawSnapshotReuseCount: null, coverage: "unavailable" });

    const absent = marketMemoryHistory({ firstSeenAt: "2026-01-02T00:00:00.000Z", observations: [] });
    expect(absent).toMatchObject({ firstRetrievedAt: null, retrievalCount: null, coverage: "partial" });

    const incomplete = marketMemoryHistory({
      firstSeenAt: "2026-01-02T00:00:00.000Z",
      observations: [{ observedAt: "2026-03-01T00:00:00.000Z", executionId: "execution-a", rawSnapshotInserted: null }],
    });
    expect(incomplete).toMatchObject({ retrievalCount: 1, rawSnapshotReuseCount: null, coverage: "partial" });
  });
});
