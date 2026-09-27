import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadNaturalYieldReport } from "../../src/server/modules/operations/natural-yield-validation.repository";
import { buildNaturalYieldReport } from "../../src/server/modules/operations/natural-yield-validation.service";
import type { NaturalYieldInput } from "../../src/server/modules/operations/natural-yield-validation.schemas";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function input(overrides: Partial<NaturalYieldInput> = {}): NaturalYieldInput {
  return {
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-01-04T00:00:00.000Z",
    workspaceId,
    productId,
    queries: [
      { jobRunId: "job-1", createdAt: "2026-01-01T12:00:00.000Z", queryPlanId: "qp-a", sourceKey: "github", queryFamily: "pain", demandSurface: "pain_first", marketPartitionKey: "partition-a", executionStatus: "completed_with_results", pagesRequested: 1, pagesCompleted: 1, rawItems: 4, rawNewItems: 3, normalizedItems: 3, uniqueConversations: 2, duplicateCount: 1, sourceBudgetSuppressedCount: 0, candidateBudgetSuppressedCount: 0, evaluationCapSuppressedCount: 0, selectedCount: 1, evaluatedCount: 1, qualifiedInfluencedCount: 1, weakInfluencedCount: 0, rejectedInfluencedCount: 0, estimatedCostUsd: null },
      { jobRunId: "job-1", createdAt: "2026-01-01T12:00:00.000Z", queryPlanId: "qp-b", sourceKey: "github", queryFamily: "feature", demandSurface: "feature_demand", marketPartitionKey: "partition-a", executionStatus: "rate_limited", pagesRequested: 1, pagesCompleted: 0, rawItems: 0, rawNewItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, sourceBudgetSuppressedCount: 0, candidateBudgetSuppressedCount: 0, evaluationCapSuppressedCount: 0, selectedCount: 0, evaluatedCount: 0, qualifiedInfluencedCount: 0, weakInfluencedCount: 0, rejectedInfluencedCount: 0, estimatedCostUsd: null },
      { jobRunId: "job-2", createdAt: "2026-01-02T12:00:00.000Z", queryPlanId: "qp-a", sourceKey: "github", queryFamily: "pain", demandSurface: "pain_first", marketPartitionKey: "partition-a", executionStatus: "completed_zero_results", pagesRequested: 1, pagesCompleted: 1, rawItems: 0, rawNewItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, sourceBudgetSuppressedCount: 0, candidateBudgetSuppressedCount: 0, evaluationCapSuppressedCount: 2, selectedCount: 0, evaluatedCount: 0, qualifiedInfluencedCount: 0, weakInfluencedCount: 0, rejectedInfluencedCount: 0, estimatedCostUsd: null },
    ],
    jobs: [
      { id: "job-1", createdAt: "2026-01-01T11:00:00.000Z", completedAt: "2026-01-01T13:00:00.000Z", status: "succeeded", inputReference: { result: { adaptiveAllocator: { mode: "shadow", baselineAllocation: { byQuery: { "qp-a": 2 } }, proposedAllocation: { byQuery: { "qp-a": 3 } }, appliedAllocation: { byQuery: { "qp-a": 2 } }, queriesShifted: 1, explorationAllocations: 1, diversityFloorAllocations: 2, sourceHealthExclusions: ["reddit"], sampleConfidence: 0.5, capPressure: { queryCapSkips: 0, candidateCapSkips: 1, evaluationCapSkips: 0 } }, crossProductRoutingShadow: { conversationsExamined: 2, routesCreated: 0, routesReused: 0, noRouteDecisions: 2, capSkips: 0, semanticCalls: 0 } } } },
      { id: "job-2", createdAt: "2026-01-02T11:00:00.000Z", completedAt: "2026-01-02T13:00:00.000Z", status: "succeeded", inputReference: { result: { adaptiveAllocator: { mode: "shadow", baselineAllocation: { byQuery: { "qp-a": 2 } }, proposedAllocation: { byQuery: { "qp-a": 2 } }, appliedAllocation: { byQuery: { "qp-a": 2 } }, queriesShifted: 0, explorationAllocations: 0, diversityFloorAllocations: 1, sourceHealthExclusions: [], sampleConfidence: 1, capPressure: { queryCapSkips: 0, candidateCapSkips: 0, evaluationCapSkips: 0 } } } } },
    ],
    evaluations: [
      { id: "eval-1", conversationId: "conversation-1", decision: "qualified", createdAt: "2026-01-01T12:30:00.000Z" },
      { id: "eval-2", conversationId: "conversation-1", decision: "qualified", createdAt: "2026-01-01T12:45:00.000Z" },
      { id: "eval-3", conversationId: "conversation-2", decision: "rejected", createdAt: "2026-01-02T12:30:00.000Z" },
    ],
    signals: [{ id: "signal-1", conversationId: "conversation-1", createdAt: "2026-01-01T13:00:00.000Z", lifecycleStatus: "active" }],
    sourceHealth: [{ sourceKey: "github", environment: "production", degradationState: "healthy", lastSuccessAt: "2026-01-02T12:00:00.000Z", lastFailureAt: null, latestErrorCode: null }],
    qualifiedEvidenceTotal: 1,
    ...overrides,
  };
}

describe("natural yield validation", () => {
  it("fills empty UTC days and keeps qualified evidence conversation-distinct per day", () => {
    const report = buildNaturalYieldReport(input());
    expect(report.daily.map((day) => day.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(report.daily[0]).toMatchObject({ scans: 1, plannedQueries: 2, executedQueries: 2, rawItems: 4, duplicateItems: 1, qualifiedEvidence: 1, newSignals: 1, rateLimitSkips: 1 });
    expect(report.daily[1]).toMatchObject({ scans: 1, plannedQueries: 1, evaluations: 1, qualifiedEvidence: 0, evaluationCapPressure: 2 });
    expect(report.daily[2]).toMatchObject({ scans: 0, plannedQueries: 0, evaluations: 0 });
    expect(report.qualifiedEvidence).toMatchObject({ total: 1, dailyBasis: "window_distinct_evaluations" });
  });

  it("groups stable source/query/partition identities and reports partial metrics honestly", () => {
    const report = buildNaturalYieldReport(input());
    expect(report.bySurface).toHaveLength(2);
    expect(report.bySurface[0]).toMatchObject({ sourceKey: "github", queryPlanId: "qp-a", marketPartitionKey: "partition-a", executions: 2 });
    expect(report.measurability.strengthenedSignals.status).toBe("NOT_MEASURABLE");
    expect(report.measurability.demandEpisodes.status).toBe("PARTIALLY_MEASURABLE");
    expect(report.daily[0].strengthenedSignals).toBeNull();
    expect(report.daily[0].distinctDemandEpisodes).toBeNull();
  });

  it("separates allocator proposal from applied baseline and summarizes routing shadow", () => {
    const report = buildNaturalYieldReport(input());
    expect(report.allocatorShadow).toMatchObject({ scansObserved: 2, proposalChanges: 1, totalQueriesShifted: 1, explorationAllocations: 1, diversityFloorAllocations: 3, appliedEqualsBaseline: true, capPressure: { query: 0, candidate: 1, evaluation: 0 } });
    expect(report.allocatorShadow.sourceHealthExclusions).toEqual(["reddit"]);
    expect(report.routingShadow).toEqual({ scansObserved: 1, conversationsExamined: 2, routesCreated: 0, routesReused: 0, noRouteDecisions: 2, capSkips: 0, semanticCalls: 0 });
  });

  it("rejects windows beyond the bounded 14-day report contract", () => {
    expect(() => buildNaturalYieldReport({ ...input(), until: "2026-01-16T00:00:00.000Z" })).toThrow(/cannot exceed 14 days/);
  });

  it("retains a late-completing scan in the day it entered the bounded window", () => {
    const report = buildNaturalYieldReport({
      ...input(),
      jobs: [...input().jobs, { id: "late-job", createdAt: "2026-01-02T23:00:00.000Z", completedAt: "2026-01-05T01:00:00.000Z", status: "succeeded", inputReference: {} }],
    });
    expect(report.daily[1]?.scans).toBe(2);
  });

  it("uses only bounded read operations in the repository", async () => {
    const calls: string[] = [];
    const builder = (table: string) => {
      const query = {
        select: (columns: string) => { calls.push(`${table}:select:${columns}`); return query; },
        eq: (field: string) => { calls.push(`${table}:eq:${field}`); return query; },
        gte: (field: string) => { calls.push(`${table}:gte:${field}`); return query; },
        lt: (field: string) => { calls.push(`${table}:lt:${field}`); return query; },
        order: (field: string) => { calls.push(`${table}:order:${field}`); return query; },
        limit: async (value: number) => { calls.push(`${table}:limit:${value}`); return { data: [], error: null }; },
      };
      return query;
    };
    const client = { from: builder, rpc: async () => ({ data: { qualifiedEvidence: { grossTotal: 0 } }, error: null }) };
    const report = await loadNaturalYieldReport({ client, ...input() });
    expect(report.qualifiedEvidence.total).toBe(0);
    expect(calls.every((call) => !call.includes(":insert") && !call.includes(":update") && !call.includes(":delete"))).toBe(true);
    expect(calls).toContain("query_yield_artifacts:limit:20000");
    expect(calls).toContain("job_runs:limit:20000");
  });
});
