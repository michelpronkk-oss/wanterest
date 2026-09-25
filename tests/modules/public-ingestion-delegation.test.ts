import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Wanterest 1B Stage 2A: proves there is exactly one discovery-loop implementation
// left in the codebase. `executeSourceDiscovery` (still exported from
// initial-scan.service.ts for backward compatibility, and still what the
// Trigger-backed `discover-product-source` task calls) must be a pure delegation
// to the shared `ingestPublicPartition` boundary, not a second implementation of
// the discovery loop.

const ingestPublicPartitionMock = vi.fn(async () => ({
  sourceKey: "github",
  rawSourceItemIds: ["raw-1"],
  normalizedSourceItemIds: ["norm-1"],
  conversationIds: ["conv-1"],
  provenance: [],
  rawInserted: 1,
  itemsReturned: 1,
  queryCount: 1,
  diagnostics: [],
  rateLimitRemaining: null,
  estimatedCost: null,
  queryTelemetry: [],
}));

vi.mock("@/server/modules/ingestion/public-ingestion.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/modules/ingestion/public-ingestion.service")>();
  return { ...actual, ingestPublicPartition: ingestPublicPartitionMock };
});

const { executeSourceDiscovery } = await import("../../src/server/modules/onboarding/initial-scan.service");

describe("executeSourceDiscovery (Stage 2A compatibility wrapper)", () => {
  it("delegates to the shared public-ingestion boundary with workspace/job context isolated into operationalContext", async () => {
    const requests = [{ query: "export", limit: 5 } as never];
    const result = await executeSourceDiscovery({
      sourceKey: "github",
      productId: "product-1",
      workspaceId: "workspace-1",
      jobRunId: "job-1",
      traceId: "trace-1",
      requests,
    });

    expect(ingestPublicPartitionMock).toHaveBeenCalledTimes(1);
    expect(ingestPublicPartitionMock).toHaveBeenCalledWith({
      sourceKey: "github",
      requests,
      traceId: "trace-1",
      operationalContext: { jobRunId: "job-1", workspaceId: "workspace-1" },
    });
    // The legacy contract (raw/normalized/conversation ids, counts) passes through
    // unchanged - existing callers of executeSourceDiscovery see no result-shape change.
    expect(result).toMatchObject({
      sourceKey: "github",
      rawSourceItemIds: ["raw-1"],
      normalizedSourceItemIds: ["norm-1"],
      conversationIds: ["conv-1"],
      rawInserted: 1,
      itemsReturned: 1,
    });
  });
});
