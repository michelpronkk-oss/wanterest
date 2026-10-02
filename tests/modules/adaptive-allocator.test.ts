import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adaptiveAllocatorMode } from "../../src/server/modules/operations/adaptive-allocator.config";
import { buildAdaptiveAllocatorOffTelemetry, buildAdaptiveAllocatorPlan } from "../../src/server/modules/operations/adaptive-allocator.policy";
import type { AdaptiveAllocatorHistoryRow, AdaptiveAllocatorSourceState } from "../../src/server/modules/operations/adaptive-allocator.schemas";
import type { QueryPlan, QueryPlanQuery } from "../../src/server/modules/operations/query-planning.schemas";

const now = new Date("2026-09-27T00:00:00.000Z");

function query(input: Partial<QueryPlanQuery> & Pick<QueryPlanQuery, "query_id" | "source_key">): QueryPlanQuery {
  return {
    query_id: input.query_id,
    source_key: input.source_key,
    query_family: input.query_family ?? "pain",
    demand_surface: input.demand_surface ?? "pain_first",
    competitor_specific: input.competitor_specific ?? false,
    intent_type: input.intent_type ?? "problem_solution_search",
    query_text: input.query_text ?? input.query_id,
    normalized_query: input.normalized_query ?? input.query_id,
    priority: input.priority ?? "high",
    confidence: input.confidence ?? 0.8,
    candidate_budget: input.candidate_budget ?? 3,
    reason_codes: input.reason_codes ?? [],
    reason_summary: input.reason_summary ?? "fixture",
    concept_keys: input.concept_keys ?? ["pain"],
    competitor_refs: input.competitor_refs ?? [],
    alternative_refs: input.alternative_refs ?? [],
    geo_context: input.geo_context ?? null,
    language_context: input.language_context ?? null,
    cost_hint: input.cost_hint ?? "free_low",
    metadata: input.metadata ?? { planner_version: "query_planning_v8" },
  };
}

function plan(queries = [
  query({ query_id: "q-high", source_key: "github", candidate_budget: 3 }),
  query({ query_id: "q-weak", source_key: "github", candidate_budget: 3 }),
  query({ query_id: "q-cold", source_key: "github", candidate_budget: 3 }),
  query({ query_id: "q-x", source_key: "x", candidate_budget: 2 }),
]): QueryPlan {
  const sourcePlans = [
    { source_key: "github", priority: "high" as const, candidate_budget: 9, query_budget: 3, queries: queries.filter((item) => item.source_key === "github"), excluded_query_families: [], reason_codes: [], confidence: 0.8 },
    { source_key: "x", priority: "medium" as const, candidate_budget: 2, query_budget: 1, queries: queries.filter((item) => item.source_key === "x"), excluded_query_families: [], reason_codes: [], confidence: 0.7 },
  ];
  return {
    version: "query_planning_v8",
    product_id: "00000000-0000-4000-8000-000000000001",
    demand_profile_version: "demand_profile_v2",
    source_routing_version: "source_routing_v1",
    scan_mode: "manual",
    overall_confidence: 0.8,
    source_plans: sourcePlans,
    diagnostics: {
      source_count: 2,
      query_count: queries.length,
      query_family_distribution: { pain: queries.length },
      demand_surface_coverage: { pain_first: "covered" },
      queries_per_source: { github: 3, x: 1 },
      candidate_budget_per_source: { github: 9, x: 2 },
      suppressed_duplicate_count: 0,
      low_confidence: false,
      messages: [],
    },
  };
}

function state(sourceKey: string, healthStatus = "healthy"): AdaptiveAllocatorSourceState {
  return { sourceKey, configured: true, controlState: "enabled", healthStatus };
}

function history(queryPlanId: string, values: Partial<AdaptiveAllocatorHistoryRow> = {}): AdaptiveAllocatorHistoryRow {
  return {
    queryPlanId,
    sourceKey: values.sourceKey ?? "github",
    queryFamily: values.queryFamily ?? "pain",
    demandSurface: values.demandSurface ?? "pain_first",
    marketPartitionKey: values.marketPartitionKey ?? "github|pain",
    createdAt: values.createdAt ?? now.toISOString(),
    executionStatus: values.executionStatus ?? "completed_with_results",
    pagesRequested: values.pagesRequested ?? 1,
    normalizedItems: values.normalizedItems ?? 4,
    uniqueConversations: values.uniqueConversations ?? 2,
    duplicateCount: values.duplicateCount ?? 0,
    selectedCount: values.selectedCount ?? 1,
    evaluatedCount: values.evaluatedCount ?? 2,
    qualifiedInfluencedCount: values.qualifiedInfluencedCount ?? 0,
    estimatedCostUsd: values.estimatedCostUsd ?? null,
  };
}

describe("adaptive allocator configuration", () => {
  it("fails closed by default and requires an explicit workspace allowlist", () => {
    expect(adaptiveAllocatorMode({})).toBe("off");
    expect(adaptiveAllocatorMode({ ADAPTIVE_ALLOCATOR_MODE: "shadow" }, "workspace")).toBe("off");
    expect(adaptiveAllocatorMode({ ADAPTIVE_ALLOCATOR_MODE: "shadow", ADAPTIVE_ALLOCATOR_WORKSPACE_IDS: "workspace" }, "workspace")).toBe("shadow");
    expect(adaptiveAllocatorMode({ ADAPTIVE_ALLOCATOR_MODE: "active", ADAPTIVE_ALLOCATOR_WORKSPACE_IDS: "workspace" }, "workspace")).toBe("active");
  });
});

describe("adaptive allocator policy", () => {
  it("keeps OFF mode bit-for-bit allocation compatible and reads no history", () => {
    const input = plan();
    const result = buildAdaptiveAllocatorOffTelemetry(input);
    expect(result.mode).toBe("off");
    expect(result.appliedAllocation).toEqual(result.baselineAllocation);
    expect(result.historyRowsRead).toBe(0);
    expect(result.queriesShifted).toBe(0);
  });

  it("computes SHADOW proposals without changing the applied plan", () => {
    const input = plan();
    const result = buildAdaptiveAllocatorPlan({
      plan: input,
      mode: "shadow",
      sourceStates: [state("github"), state("x")],
      rotationSeed: "scan-1",
      now,
      history: [history("q-high", { qualifiedInfluencedCount: 3, evaluatedCount: 3, uniqueConversations: 3 }), history("q-weak", { evaluatedCount: 8, uniqueConversations: 8 })],
    });
    expect(result.telemetry.mode).toBe("shadow");
    expect(result.plan).toEqual(input);
    expect(result.telemetry.proposedAllocation.totalCandidateSlots).toBe(result.telemetry.baselineAllocation.totalCandidateSlots);
    expect(result.telemetry.appliedAllocation).toEqual(result.telemetry.baselineAllocation);
  });

  it("applies ACTIVE recommendations with a zero-sum per-source candidate budget", () => {
    const result = buildAdaptiveAllocatorPlan({
      plan: plan(),
      mode: "active",
      sourceStates: [state("github"), state("x")],
      rotationSeed: "scan-1",
      now,
      history: [history("q-high", { qualifiedInfluencedCount: 3, evaluatedCount: 3, uniqueConversations: 3 }), history("q-weak", { evaluatedCount: 8, uniqueConversations: 8 })],
    });
    expect(result.telemetry.appliedAllocation.totalCandidateSlots).toBe(result.telemetry.baselineAllocation.totalCandidateSlots);
    expect(result.telemetry.appliedAllocation.bySource).toEqual(result.telemetry.baselineAllocation.bySource);
    expect(result.telemetry.appliedAllocation.byQuery["q-high"]).toBeGreaterThan(result.telemetry.appliedAllocation.byQuery["q-weak"]);
    expect(result.plan.source_plans.flatMap((source) => source.queries).every((item) => item.metadata.planner_version === "query_planning_v8")).toBe(true);
  });

  it("optimizes qualified evidence rather than raw volume", () => {
    const result = buildAdaptiveAllocatorPlan({
      plan: plan(),
      mode: "active",
      sourceStates: [state("github"), state("x")],
      rotationSeed: "scan-raw-volume",
      now,
      history: [
        history("q-high", { normalizedItems: 2, uniqueConversations: 2, evaluatedCount: 2, selectedCount: 1, qualifiedInfluencedCount: 1 }),
        history("q-weak", { normalizedItems: 100, uniqueConversations: 80, evaluatedCount: 20, selectedCount: 20, qualifiedInfluencedCount: 0 }),
      ],
    });
    expect(result.telemetry.surfaceScores.find((item) => item.queryPlanId === "q-high")!.score).toBeGreaterThan(result.telemetry.surfaceScores.find((item) => item.queryPlanId === "q-weak")!.score);
  });

  it("retains cold-start exploration capacity", () => {
    const result = buildAdaptiveAllocatorPlan({ plan: plan(), mode: "active", sourceStates: [state("github"), state("x")], rotationSeed: "scan-cold", now, history: [] });
    const cold = result.telemetry.surfaceScores.find((item) => item.queryPlanId === "q-cold")!;
    expect(cold.reasonCodes).toContain("NEUTRAL_COLD_START");
    expect(result.telemetry.appliedAllocation.byQuery["q-cold"]).toBeGreaterThanOrEqual(1);
  });

  it("does not let one lucky low-sample result dominate mature history", () => {
    const result = buildAdaptiveAllocatorPlan({
      plan: plan(),
      mode: "shadow",
      sourceStates: [state("github"), state("x")],
      rotationSeed: "scan-confidence",
      now,
      history: [
        history("q-high", { evaluatedCount: 1, uniqueConversations: 1, selectedCount: 1, qualifiedInfluencedCount: 1 }),
        ...Array.from({ length: 10 }, () => history("q-weak", { evaluatedCount: 10, uniqueConversations: 10, selectedCount: 2, qualifiedInfluencedCount: 1 })),
      ],
    });
    const lucky = result.telemetry.surfaceScores.find((item) => item.queryPlanId === "q-high")!;
    const mature = result.telemetry.surfaceScores.find((item) => item.queryPlanId === "q-weak")!;
    expect(lucky.confidence).toBeLessThan(mature.confidence);
  });

  it("preserves source diversity and does not reactivate unhealthy sources", () => {
    const result = buildAdaptiveAllocatorPlan({ plan: plan(), mode: "active", sourceStates: [state("github"), state("x", "blocked")], rotationSeed: "scan-health", now, history: [history("q-x", { sourceKey: "x", qualifiedInfluencedCount: 10 })] });
    expect(result.telemetry.appliedAllocation.bySource).toEqual(result.telemetry.baselineAllocation.bySource);
    expect(result.telemetry.sourceHealthExclusions).toContain("x:blocked");
    expect(result.telemetry.appliedAllocation.byQuery["q-x"]).toBe(result.telemetry.baselineAllocation.byQuery["q-x"]);
  });

  it("is deterministic for identical state and reports partition history without inventing a partition allocation", () => {
    const input = { plan: plan(), mode: "active" as const, sourceStates: [state("github"), state("x")], rotationSeed: "scan-deterministic", now, history: [history("q-high", { marketPartitionKey: "github|pain|one", qualifiedInfluencedCount: 2 }), history("q-high", { marketPartitionKey: "github|pain|two", qualifiedInfluencedCount: 0 })] };
    const first = buildAdaptiveAllocatorPlan(input);
    const second = buildAdaptiveAllocatorPlan(input);
    // Wall-clock duration is volatile telemetry and does not affect the allocation.
    const withoutRuntimeMeasurement = (result: typeof first) => ({
      ...result,
      telemetry: { ...result.telemetry, computationDurationMs: 0 },
    });
    expect(withoutRuntimeMeasurement(first)).toEqual(withoutRuntimeMeasurement(second));
    expect(first.telemetry.warnings).toContain("Partition identity is not available before provider request construction; partition allocation remains observational in V1.");
  });

  it("keeps competitor slots from increasing when non-competitor supply exists", () => {
    const competitorPlan = plan([
      query({ query_id: "q-comp", source_key: "github", candidate_budget: 3, competitor_specific: true, demand_surface: "competitor_pain" }),
      query({ query_id: "q-pain", source_key: "github", candidate_budget: 3 }),
      query({ query_id: "q-feature", source_key: "github", candidate_budget: 3, query_family: "feature_requirement", demand_surface: "feature_demand" }),
      query({ query_id: "q-x", source_key: "x", candidate_budget: 2 }),
    ]);
    const result = buildAdaptiveAllocatorPlan({ plan: competitorPlan, mode: "active", sourceStates: [state("github"), state("x")], rotationSeed: "scan-competitor", now, history: [history("q-comp", { qualifiedInfluencedCount: 10 })] });
    expect(result.telemetry.appliedAllocation.byQuery["q-comp"]).toBe(result.telemetry.baselineAllocation.byQuery["q-comp"]);
    expect(result.telemetry.capPressure.competitorMixConstrained).toBe(true);
  });
});
