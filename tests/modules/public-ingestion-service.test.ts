import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Wanterest 1B Stage 2A behavior-preservation tests for the shared public-ingestion
// boundary. These exercise `ingestPublicPartition` in isolation (no real Supabase
// client, no real provider network calls) to prove the extracted discovery loop
// preserves exactly the request ordering, pagination/cursor semantics, dedup, and
// error handling that previously lived inline in `executeSourceDiscovery`.

const discoverSourceMock = vi.fn();
const replayDetailedMock = vi.fn();

vi.mock("@/server/modules/ingestion/ingestion.service", () => ({
  IngestionService: vi.fn().mockImplementation(() => ({
    discoverSource: discoverSourceMock,
    replayDetailed: replayDetailedMock,
  })),
}));
vi.mock("@/server/modules/ingestion/ingestion.repository", () => ({ SupabaseIngestionRepository: vi.fn() }));
vi.mock("@/server/modules/operations/source-control.service", () => ({
  SourceControlService: vi.fn(),
  SupabaseSourceControlStore: vi.fn(),
}));
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/server/providers/source/x/x.internal", () => ({
  getInternalXDiscoveryOverride: () => null,
  logInternalXDiscoveryOverride: vi.fn(),
}));

const { ingestPublicPartition } = await import("../../src/server/modules/ingestion/public-ingestion.service");
const { sourceDiscoveryRequestSchema } = await import("../../src/server/providers/source/contracts");

function req(overrides: { query?: string; limit?: number; requestMetadata?: Record<string, unknown> } = {}) {
  return sourceDiscoveryRequestSchema.parse({ query: "export", limit: 5, ...overrides });
}

function discoveryPage(overrides: Partial<{ rawSourceItemIds: string[]; rawInserted: number; nextCursor: string | undefined; diagnostics: string[] }> = {}) {
  return {
    rawSourceItemIds: overrides.rawSourceItemIds ?? [],
    rawInserted: overrides.rawInserted ?? 0,
    diagnostics: overrides.diagnostics ?? [],
    nextCursor: overrides.nextCursor,
  };
}

function replayResult(overrides: Partial<{ normalizedSourceItemIds: string[]; canonicalizedConversationIds: string[] }> = {}) {
  const canonicalizedConversationIds = overrides.canonicalizedConversationIds ?? [];
  return {
    normalizedSourceItemIds: overrides.normalizedSourceItemIds ?? [],
    canonicalizedConversationIds,
    replayMappings: canonicalizedConversationIds.map((conversationId) => ({ conversationId })),
  };
}

describe("ingestPublicPartition (Stage 2A shared public-ingestion boundary)", () => {
  beforeEach(() => {
    discoverSourceMock.mockReset();
    replayDetailedMock.mockReset();
  });

  it("does not require workspaceId or productId to execute discovery and replay", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.rawSourceItemIds).toEqual(["raw-1"]);
    expect(result.normalizedSourceItemIds).toEqual(["norm-1"]);
    expect(result.conversationIds).toEqual(["conv-1"]);
    expect(result.rawInserted).toBe(1);
    expect(result.itemsReturned).toBe(1);
    expect(result.queryCount).toBe(1);

    // Operational scoping (scanJobRunId / internalWorkspaceId) must never be stamped
    // onto the request when operationalContext is omitted - proves workspace/product
    // context is not required for the ingestion semantics themselves.
    const [, requestArg] = discoverSourceMock.mock.calls[0]!;
    expect(requestArg.requestMetadata?.scanJobRunId).toBeUndefined();
    expect(requestArg.requestMetadata?.internalWorkspaceId).toBeUndefined();
  });

  it("scopes the request to the job run only when operationalContext is provided", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage());
    replayDetailedMock.mockResolvedValueOnce(replayResult());

    await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
      operationalContext: { jobRunId: "job-1", workspaceId: "workspace-1" },
    });

    const [, requestArg] = discoverSourceMock.mock.calls[0]!;
    expect(requestArg.requestMetadata?.scanJobRunId).toBe("job-1");
  });

  it("preserves the existing up-to-3-page cursor continuation loop and request ordering", async () => {
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1, nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-2"], rawInserted: 1, nextCursor: "cursor-3" }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-3"], rawInserted: 1, nextCursor: "cursor-4" }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-2"], canonicalizedConversationIds: ["conv-2"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-3"], canonicalizedConversationIds: ["conv-3"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ requestMetadata: { maxPages: 5 } })],
      traceId: "trace-1",
    });

    // Capped at 3 pages even though the mock always returns another cursor and the
    // request asked for up to 5 - this is the existing, unchanged safety cap.
    expect(discoverSourceMock).toHaveBeenCalledTimes(3);
    expect(replayDetailedMock).toHaveBeenCalledTimes(3);
    expect(discoverSourceMock.mock.calls[1]![1].cursor).toBe("cursor-2");
    expect(discoverSourceMock.mock.calls[2]![1].cursor).toBe("cursor-3");
    expect(result.rawSourceItemIds).toEqual(["raw-1", "raw-2", "raw-3"]);
    expect(result.conversationIds).toEqual(["conv-1", "conv-2", "conv-3"]);
  });

  it("deduplicates repeated raw/normalized/conversation ids across requests", async () => {
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 0 }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ query: "a" }), req({ query: "b" })],
      traceId: "trace-1",
    });

    expect(result.rawSourceItemIds).toEqual(["raw-1"]);
    expect(result.normalizedSourceItemIds).toEqual(["norm-1"]);
    expect(result.conversationIds).toEqual(["conv-1"]);
    expect(result.queryCount).toBe(2);
  });

  it("records a provider failure without throwing, matching the prior error-mapping behavior", async () => {
    discoverSourceMock.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "RATE_LIMITED" }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.failedQueryCount).toBe(1);
    expect(result.errorCode).toBe("RATE_LIMITED");
    expect(result.queryTelemetry[0]?.executionStatus).toBe("rate_limited");
    expect(result.diagnostics[0]).toMatch(/^query provider_error/);
  });

  it("reports zero-result completion status without treating it as a failure", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage());
    replayDetailedMock.mockResolvedValueOnce(replayResult());

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.failedQueryCount).toBeUndefined();
    expect(result.queryTelemetry[0]?.executionStatus).toBe("completed_zero_results");
  });
});
