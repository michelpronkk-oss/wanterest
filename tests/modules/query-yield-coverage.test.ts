import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDiscoveryCoverageConfig } from "../../src/server/modules/operations/discovery-coverage.config";
import { QueryYieldRepository, type QueryYieldArtifact } from "../../src/server/modules/operations/query-yield.repository";
import { aggregateQueryYield, boundedCursorContinuationCount, finalizeQueryYieldTelemetry, reconcileQueryYieldTelemetry, sourceHealthStatus, type QueryYieldTelemetry } from "../../src/server/modules/operations/query-yield-telemetry";

const workspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";

function setServerEnv(overrides: Record<string, string | undefined> = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubEnv("DISCOVERY_COVERAGE_V1_ENABLED", overrides.DISCOVERY_COVERAGE_V1_ENABLED);
  vi.stubEnv("DISCOVERY_COVERAGE_V1_WORKSPACE_IDS", overrides.DISCOVERY_COVERAGE_V1_WORKSPACE_IDS);
  vi.stubEnv("DISCOVERY_COVERAGE_V1_MAX_SOURCES", overrides.DISCOVERY_COVERAGE_V1_MAX_SOURCES);
  vi.stubEnv("DISCOVERY_COVERAGE_V1_MAX_QUERIES", overrides.DISCOVERY_COVERAGE_V1_MAX_QUERIES);
  vi.stubEnv("DISCOVERY_COVERAGE_V1_MAX_CANDIDATES", overrides.DISCOVERY_COVERAGE_V1_MAX_CANDIDATES);
}

const artifact: QueryYieldArtifact = {
  workspaceId,
  productId: "product-a",
  jobRunId: "job-a",
  queryPlanId: "query-a",
  sourceKey: "github",
  queryFamily: "alternative_search",
  demandSurface: "alternative_search",
  conceptKeys: ["jira"],
  competitorSpecific: true,
  retrievalWindow: {},
  pagesRequested: 1,
  pagesCompleted: 1,
  cursorContinuationCount: 0,
  continuationStoppedReason: "no_cursor",
  executionStatus: "completed_with_results",
  rawItems: 2,
  normalizedItems: 2,
  uniqueConversations: 2,
  duplicateCount: 0,
  sourceBudgetSuppressedCount: 0,
  candidateBudgetSuppressedCount: 0,
  evaluationCapSuppressedCount: 0,
  selectedCount: 1,
  evaluatedCount: 1,
  qualifiedInfluencedCount: 1,
  weakInfluencedCount: 0,
  rejectedInfluencedCount: 0,
  estimatedCostUsd: null,
};

function repositoryClient(insertResult: { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }) {
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn(async () => insertResult) })) }));
  return { from: vi.fn(() => ({ insert })), insert };
}

function telemetry(queryPlanId: string, normalizedItems: number, uniqueConversations: number): QueryYieldTelemetry {
  return {
    queryPlanId,
    source: "github",
    family: "alternative_search",
    surface: "alternative_search",
    concepts: ["jira"],
    competitorSpecific: true,
    pagesRequested: 1,
    pagesCompleted: 1,
    cursorContinuationCount: 0,
    continuationStoppedReason: "no_cursor",
    executionStatus: "completed_with_results",
    rawItems: normalizedItems,
    normalizedItems,
    uniqueConversations,
    duplicateCount: normalizedItems - uniqueConversations,
    estimatedCostUsd: null,
  };
}

describe("Discovery Coverage V1 and query-yield persistence", () => {
  it("enables expanded caps only for the allowlisted internal workspace", () => {
    setServerEnv({ DISCOVERY_COVERAGE_V1_ENABLED: "true", DISCOVERY_COVERAGE_V1_WORKSPACE_IDS: ` other, ${workspaceId} ` });
    expect(getDiscoveryCoverageConfig(workspaceId)).toEqual({ enabled: true, maxSources: 6, maxQueries: 16, maxCandidates: 60 });
    expect(getDiscoveryCoverageConfig("00000000-0000-4000-8000-000000000001").enabled).toBe(false);
  });

  it("uses safe defaults and recognizes the comma-separated workspace allowlist", () => {
    setServerEnv({ DISCOVERY_COVERAGE_V1_ENABLED: "true", DISCOVERY_COVERAGE_V1_WORKSPACE_IDS: workspaceId });
    expect(getDiscoveryCoverageConfig(workspaceId)).toMatchObject({ maxSources: 6, maxQueries: 16, maxCandidates: 60 });
    setServerEnv({ DISCOVERY_COVERAGE_V1_ENABLED: "true", DISCOVERY_COVERAGE_V1_WORKSPACE_IDS: "other-workspace" });
    expect(getDiscoveryCoverageConfig(workspaceId).enabled).toBe(false);
  });

  it("invokes immutable persistence once for each finalized telemetry row", async () => {
    const db = repositoryClient({ data: { id: "artifact-a" }, error: null });
    const repository = new QueryYieldRepository(db);
    const finalized = finalizeQueryYieldTelemetry(
      [telemetry("query-a", 2, 2)],
      [{ conversationId: "conversation-a", queryPlanId: "query-a" }],
      new Map([["conversation-a", { conversationId: "conversation-a", selected: true, evaluated: true, qualificationStatus: "qualified" }]]),
    );
    for (const row of finalized) await repository.insertImmutable({ ...artifact, queryPlanId: row.queryPlanId, selectedCount: row.selectedCount, evaluatedCount: row.evaluatedCount, qualifiedInfluencedCount: row.qualifiedInfluencedCount, weakInfluencedCount: row.weakInfluencedCount, rejectedInfluencedCount: row.rejectedInfluencedCount });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("persists exactly one immutable artifact per planned query after finalization", async () => {
    const db = repositoryClient({ data: { id: "artifact-hn" }, error: null });
    const repository = new QueryYieldRepository(db);
    const hnTelemetry: QueryYieldTelemetry = {
      ...telemetry("hn-1", 0, 0),
      source: "hacker-news",
      family: "pain",
      surface: "pain_first",
      concepts: [],
      competitorSpecific: false,
      pagesRequested: 3,
      pagesCompleted: 3,
      cursorContinuationCount: boundedCursorContinuationCount(3, 3),
      continuationStoppedReason: "page_cap_reached",
      executionStatus: "completed_zero_results",
      rawItems: 0,
      normalizedItems: 0,
      uniqueConversations: 0,
      duplicateCount: 0,
    };
    const reconciled = reconcileQueryYieldTelemetry(
      [
        { queryPlanId: "hn-1", source: "hacker-news", family: "pain", surface: "pain_first", concepts: [], competitorSpecific: false },
        { queryPlanId: "g2-1", source: "g2", family: "pain", surface: "pain_first", concepts: [], competitorSpecific: false },
        { queryPlanId: "x-1", source: "x", family: "pain", surface: "pain_first", concepts: [], competitorSpecific: false },
      ],
      [hnTelemetry],
      [
        { source: "hacker-news", status: "completed", queryCount: 1 },
        { source: "g2", status: "failed", queryCount: 1 },
        { source: "x", status: "completed", queryCount: 0 },
      ],
    );
    const finalized = finalizeQueryYieldTelemetry(reconciled.rows, [], new Map());

    for (const row of finalized) {
      await repository.insertImmutable({
        ...artifact,
        queryPlanId: row.queryPlanId,
        sourceKey: row.source,
        queryFamily: row.family,
        demandSurface: row.surface,
        conceptKeys: row.concepts,
        competitorSpecific: row.competitorSpecific,
        pagesRequested: row.pagesRequested,
        pagesCompleted: row.pagesCompleted,
        cursorContinuationCount: row.cursorContinuationCount,
        continuationStoppedReason: row.continuationStoppedReason,
        executionStatus: row.executionStatus,
        rawItems: row.rawItems,
        normalizedItems: row.normalizedItems,
        uniqueConversations: row.uniqueConversations,
        duplicateCount: row.duplicateCount,
        selectedCount: row.selectedCount,
        evaluatedCount: row.evaluatedCount,
        qualifiedInfluencedCount: row.qualifiedInfluencedCount,
        weakInfluencedCount: row.weakInfluencedCount,
        rejectedInfluencedCount: row.rejectedInfluencedCount,
      });
    }

    expect(reconciled.missingQueryPlanIds).toEqual([]);
    expect(reconciled.terminalQueryArtifactCount).toBe(3);
    expect(db.insert).toHaveBeenCalledTimes(3);
    const inserted = db.insert.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(new Set(inserted.map((call) => call[0]?.query_plan_id))).toEqual(new Set(["hn-1", "g2-1", "x-1"]));
    expect(inserted.map((call) => call[0]?.execution_status)).toEqual(["completed_zero_results", "provider_error", "budget_limited"]);
    expect(inserted[0]?.[0]).toMatchObject({
      query_plan_id: "hn-1",
      source_key: "hacker-news",
      execution_status: "completed_zero_results",
      normalized_items: 0,
      unique_conversations: 0,
      cursor_continuation_count: 2,
    });
  });

  it("returns the inserted immutable artifact", async () => {
    const db = repositoryClient({ data: { id: "artifact-a" }, error: null });
    await expect(new QueryYieldRepository(db).insertImmutable(artifact)).resolves.toEqual({ id: "artifact-a" });
  });

  it("surfaces persistence errors with a bounded database warning", async () => {
    const db = repositoryClient({ data: null, error: { code: "42501", message: "permission denied for table query_yield_artifacts" } });
    await expect(new QueryYieldRepository(db).insertImmutable(artifact)).rejects.toThrow("42501");
    await expect(new QueryYieldRepository(db).insertImmutable(artifact)).rejects.toThrow("permission denied");
  });

  it("does not swallow non-unique database errors", async () => {
    const db = repositoryClient({ data: null, error: { code: "23503", message: "foreign key violation" } });
    await expect(new QueryYieldRepository(db).insertImmutable(artifact)).rejects.toThrow("23503");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("keeps true unique conversation aggregates at or below normalized counts", () => {
    const aggregate = aggregateQueryYield([telemetry("query-a", 4, 3), telemetry("query-b", 4, 2)]).bySource.github;
    expect(aggregate.unique).toBeLessThanOrEqual(aggregate.normalized);
  });

  it("allows multi-query influenced counts to exceed a single global conversation", () => {
    const rows = [telemetry("query-a", 1, 1), telemetry("query-b", 1, 1)];
    const finalized = finalizeQueryYieldTelemetry(
      rows,
      [{ conversationId: "conversation-a", queryPlanId: "query-a" }, { conversationId: "conversation-a", queryPlanId: "query-b" }],
      new Map([["conversation-a", { conversationId: "conversation-a", selected: true, evaluated: true, qualificationStatus: "qualified" }]]),
    );
    const aggregate = aggregateQueryYield(finalized).bySource.github;
    expect(new Set(["conversation-a"]).size).toBe(1);
    expect(aggregate.qualifiedInfluenced).toBe(2);
    expect(aggregate.unique).toBeLessThanOrEqual(aggregate.normalized);
  });

  it("reconciles every planned query, including an X query suppressed by a source cap", () => {
    const result = reconcileQueryYieldTelemetry(
      ["x-1", "x-2", "x-3"].map((queryPlanId) => ({ queryPlanId, source: "x", family: "pain", surface: "pain_first", concepts: [], competitorSpecific: false })),
      [telemetry("x-1", 1, 1), telemetry("x-2", 0, 0)],
      [{ source: "x", status: "completed", queryCount: 2, errorCode: null }],
    );
    expect(result.plannedQueryCount).toBe(3);
    expect(result.terminalQueryArtifactCount).toBe(3);
    expect(result.missingQueryPlanIds).toEqual([]);
    expect(result.rows.map((row) => row.executionStatus)).toEqual(["completed_with_results", "completed_with_results", "budget_limited"]);
  });

  it("creates terminal provider-error artifacts for every query of a failed source", () => {
    const result = reconcileQueryYieldTelemetry(
      ["g2-1", "g2-2"].map((queryPlanId) => ({ queryPlanId, source: "g2", family: "pain", surface: "pain_first", concepts: [], competitorSpecific: false })),
      [],
      [{ source: "g2", status: "failed", queryCount: 2, errorCode: null }],
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.executionStatus === "provider_error" && row.normalizedItems === 0)).toBe(true);
  });

  it("keeps successful sibling query artifacts when one planned query has a provider error", () => {
    const result = reconcileQueryYieldTelemetry(
      [
        { queryPlanId: "github-pain", source: "github", family: "pain", surface: "pain_first", concepts: ["pain"], competitorSpecific: false },
        { queryPlanId: "github-feature", source: "github", family: "feature_requirement", surface: "feature_demand", concepts: ["feature"], competitorSpecific: false },
        { queryPlanId: "github-job", source: "github", family: "jtbd", surface: "job_demand", concepts: ["job"], competitorSpecific: false },
      ],
      [
        { ...telemetry("github-pain", 0, 0), executionStatus: "provider_error", continuationStoppedReason: "error", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0 },
        telemetry("github-feature", 2, 2),
        telemetry("github-job", 1, 1),
      ],
      [{ source: "github", status: "completed", queryCount: 3, errorCode: "HTTP_422" }],
    );
    expect(result.rows.map((row) => [row.queryPlanId, row.executionStatus, row.normalizedItems])).toEqual([
      ["github-pain", "provider_error", 0],
      ["github-feature", "completed_with_results", 2],
      ["github-job", "completed_with_results", 1],
    ]);
    expect(result.missingQueryPlanIds).toEqual([]);
  });

  it("gives explicit failed source status precedence over zero-result classification", () => {
    expect(sourceHealthStatus({ planned: true, executed: true, executionStatus: "failed", normalizedItems: 0, errorCode: null })).toBe("provider_error");
    expect(sourceHealthStatus({ planned: true, executed: true, executionStatus: "completed", normalizedItems: 0, errorCode: null })).toBe("completed_zero_results");
  });
});
