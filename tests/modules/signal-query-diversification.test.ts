import { describe, expect, it } from "vitest";

import { queryIntentFamilySchema, signalQueryExplorationV11Version, type QueryPlan, type QueryPlanQuery, type QueryPlanningInput } from "../../src/server/modules/operations/query-planning.schemas";
import { queryNoveltyState, diversifySignalQueries, exploreSignalQueriesV11, type SignalQueryHistoryRow } from "../../src/server/modules/operations/signal-query-diversification.policy";
import { queryIntentFamilyForCandidate } from "../../src/server/modules/operations/signal-query-intent";
import { signalQueryDiversificationEnabled, signalQueryExplorationV11Enabled } from "../../src/server/modules/operations/signal-query-diversification.config";
import { toSourceDiscoveryRequest } from "../../src/server/modules/operations/query-planning.execution";

function query(id: string, family: QueryPlanQuery["query_family"], concept: string, confidence: number, sourceKey = "github"): QueryPlanQuery {
  return {
    query_id: id, query_family: family, demand_surface: family === "pain" ? "pain_first" : "feature_demand",
    competitor_specific: false, intent_type: family === "feature_requirement" ? "feature_requirement" : "problem_solution_search",
    query_text: id, normalized_query: id, source_key: sourceKey, priority: "high", confidence, candidate_budget: 1,
    reason_codes: [], reason_summary: "Grounded candidate", concept_keys: [concept], competitor_refs: [], alternative_refs: [],
    geo_context: null, language_context: null, cost_hint: "free_low", metadata: { planner_version: "query_planning_v8" },
  };
}

const planningInput = {
  classification: null,
  demandProfile: {
    product_name: "Product", pains: [{ key: "pain", label: "confusing interface", description: "Difficult for operators", confidence: 0.9, specificity: 0.9, severity_hint: 0.8, evidence: [] }],
    feature_demands: [{ key: "feature", feature: "API integration", category: null, importance_hint: 0.9, confidence: 0.9, evidence: [] }],
    jobs_to_be_done: [], switching_triggers: [], buying_intents: [], objections: [], known_competitors: [],
    detected_competitor_candidates: [], alternative_solutions: [], comparison_terms: [], desired_outcomes: [],
  },
} as unknown as QueryPlanningInput;

function history(fingerprint: string, rows: Array<Partial<SignalQueryHistoryRow> & Pick<SignalQueryHistoryRow, "uniqueRoots" | "newIndependentRoots" | "completedAt">>): SignalQueryHistoryRow[] {
  return rows.map((row) => ({
    scanRunId: row.scanRunId ?? String(rows.indexOf(row)).padStart(4, "0"),
    queryPlanFingerprint: fingerprint,
    sourceKey: row.sourceKey ?? "github",
    queryVariantVersion: "signal_query_diversification_v1",
    executionStatus: "completed_with_results",
    ...row,
    newRootAttributions: row.newRootAttributions ?? row.newIndependentRoots,
  }));
}

function planFor(queries: QueryPlanQuery[], sourceKey = queries[0]?.source_key ?? "github"): QueryPlan {
  const candidateBudget = queries.reduce((sum, item) => sum + item.candidate_budget, 0);
  return {
    version: "query_planning_v8", product_id: "product", demand_profile_version: "v2", source_routing_version: "source_routing_v1",
    scan_mode: "manual", overall_confidence: 0.9,
    source_plans: [{ source_key: sourceKey, priority: "high", candidate_budget: candidateBudget, query_budget: queries.length, queries, excluded_query_families: [], reason_codes: [], confidence: 0.9 }],
    diagnostics: { source_count: 1, query_count: queries.length, query_family_distribution: {}, demand_surface_coverage: {}, queries_per_source: { [sourceKey]: queries.length }, candidate_budget_per_source: { [sourceKey]: candidateBudget }, suppressed_duplicate_count: 0, low_confidence: false, messages: [] },
  };
}

const v11Now = new Date("2026-10-01T12:00:00.000Z");

function v11(plan: QueryPlan, candidates: QueryPlanQuery[], rows: SignalQueryHistoryRow[] = []) {
  return exploreSignalQueriesV11({ plan, planningInput, candidatePool: candidates, history: rows, now: v11Now, fingerprintForQuery: (item) => item.query_id });
}

describe("Signal Query Diversification V1", () => {
  it("is disabled unless the exact server-side opt-in value is present", () => {
    expect(signalQueryDiversificationEnabled({})).toBe(false);
    expect(signalQueryDiversificationEnabled({ SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED: "TRUE" })).toBe(false);
    expect(signalQueryDiversificationEnabled({ SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED: "1" })).toBe(false);
    expect(signalQueryDiversificationEnabled({ SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED: "true" })).toBe(true);
  });

  it("keeps V1.1 disabled unless its exact server-side flag is true and requires V1 separately", () => {
    expect(signalQueryExplorationV11Enabled({})).toBe(false);
    expect(signalQueryExplorationV11Enabled({ SIGNAL_QUERY_EXPLORATION_V11_ENABLED: "TRUE" })).toBe(false);
    expect(signalQueryExplorationV11Enabled({ SIGNAL_QUERY_EXPLORATION_V11_ENABLED: "1" })).toBe(false);
    expect(signalQueryExplorationV11Enabled({ SIGNAL_QUERY_EXPLORATION_V11_ENABLED: "true" })).toBe(true);
  });

  it("keeps a closed typed taxonomy and classifies only supported profile evidence", () => {
    expect(queryIntentFamilySchema.options).toHaveLength(17);
    expect(queryIntentFamilyForCandidate(planningInput, query("pain-query", "pain", "pain", 0.9))).toBe("pain_frustration");
    expect(queryIntentFamilyForCandidate(planningInput, query("feature-query", "feature_requirement", "feature", 0.9))).toBe("missing_integration");
    expect(queryIntentFamilyForCandidate(planningInput, query("unbacked-recommendation", "recommendation", "category", 0.9))).toBe("unclassified");
  });

  it("requires three consecutive result-bearing V1 executions and a minimum evidence sample", () => {
    const rows = history("fingerprint", [
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T03:00:00Z" },
      { uniqueRoots: 4, newIndependentRoots: 1, completedAt: "2026-09-29T03:00:00Z" },
      { uniqueRoots: 2, newIndependentRoots: 0, completedAt: "2026-09-28T03:00:00Z" },
    ]);
    expect(queryNoveltyState(rows, "fingerprint")).toBe("low_novelty");
    expect(queryNoveltyState(rows.slice(0, 2), "fingerprint")).toBe("insufficient_history");
    expect(queryNoveltyState(history("fingerprint", [
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T03:00:00Z" },
      { uniqueRoots: 4, newIndependentRoots: 1, completedAt: "2026-09-29T03:00:00Z" },
      { uniqueRoots: 2, newIndependentRoots: 1, completedAt: "2026-09-28T03:00:00Z" },
    ]), "fingerprint")).toBe("observed");
    expect(queryNoveltyState(rows.map((row) => ({ ...row, queryVariantVersion: "legacy" })), "fingerprint")).toBe("cold_start");
    expect(queryNoveltyState(history("fingerprint", [
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T03:00:00Z" },
      { uniqueRoots: 0, newIndependentRoots: 0, executionStatus: "completed_zero_results", completedAt: "2026-09-29T03:00:00Z" },
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-28T03:00:00Z" },
    ]), "fingerprint")).toBe("observed");
  });

  it("uses bounded deterministic slot replacement and preserves budgets", () => {
    const pain = query("pain-query", "pain", "pain", 0.9);
    const feature = query("feature-query", "feature_requirement", "feature", 0.84);
    const plan: QueryPlan = {
      version: "query_planning_v8", product_id: "product", demand_profile_version: "v2", source_routing_version: "source_routing_v1",
      scan_mode: "manual", overall_confidence: 0.9,
      source_plans: [{ source_key: "github", priority: "high", candidate_budget: 2, query_budget: 1, queries: [pain], excluded_query_families: [], reason_codes: [], confidence: 0.9 }],
      diagnostics: { source_count: 1, query_count: 1, query_family_distribution: { pain: 1 }, demand_surface_coverage: { pain_first: "covered" }, queries_per_source: { github: 1 }, candidate_budget_per_source: { github: 1 }, suppressed_duplicate_count: 0, low_confidence: false, messages: [] },
    };
    const args = { plan, planningInput, candidatePool: [pain, feature], history: [] as SignalQueryHistoryRow[], historyState: "available" as const, fingerprintForQuery: (row: QueryPlanQuery) => row.query_id };
    const first = diversifySignalQueries(args);
    const second = diversifySignalQueries(args);
    expect(first).toEqual(second);
    expect(first.plan.source_plans[0]?.queries).toHaveLength(1);
    expect(first.plan.source_plans[0]?.candidate_budget).toBe(plan.source_plans[0]?.candidate_budget);
    expect(first.plan.source_plans[0]?.queries[0]).toMatchObject({ intent_family: "pain_frustration", query_variant_version: "signal_query_diversification_v1" });
    expect(first.plan.version).toBe("query_planning_v8");
    expect(first.summary.queryCountBefore).toBe(first.summary.queryCountAfter);
  });

  it("deprioritizes a low-novelty query only when a comparable alternative exists, never excludes it", () => {
    const pain = query("pain-query", "pain", "pain", 0.9);
    const feature = query("feature-query", "feature_requirement", "feature", 0.84);
    const plan: QueryPlan = {
      version: "query_planning_v8", product_id: "product", demand_profile_version: "v2", source_routing_version: "source_routing_v1",
      scan_mode: "manual", overall_confidence: 0.9,
      source_plans: [{ source_key: "github", priority: "high", candidate_budget: 1, query_budget: 1, queries: [pain], excluded_query_families: [], reason_codes: [], confidence: 0.9 }],
      diagnostics: { source_count: 1, query_count: 1, query_family_distribution: { pain: 1 }, demand_surface_coverage: { pain_first: "covered" }, queries_per_source: { github: 1 }, candidate_budget_per_source: { github: 1 }, suppressed_duplicate_count: 0, low_confidence: false, messages: [] },
    };
    const prior = history("pain-query", [
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T03:00:00Z" },
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-29T03:00:00Z" },
      { uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-28T03:00:00Z" },
    ]);
    const treatment = diversifySignalQueries({ plan, planningInput, candidatePool: [pain, feature], history: prior, historyState: "available", fingerprintForQuery: (row) => row.query_id });
    expect(treatment.plan.source_plans[0]?.queries[0]?.query_id).toBe("feature-query");
    const noAlternative = diversifySignalQueries({ plan, planningInput, candidatePool: [], history: prior, historyState: "available", fingerprintForQuery: (row) => row.query_id });
    expect(noAlternative.plan.source_plans[0]?.queries[0]?.query_id).toBe("pain-query");
    expect(noAlternative.plan.source_plans[0]?.queries[0]?.metadata.novelty_state).toBe("low_novelty");
  });
  it("uses provider-specific priorities and explores distinct supported families within existing slots", () => {
    const providerInput = {
      ...planningInput,
      demandProfile: {
        ...planningInput.demandProfile!,
        feature_demands: [{ key: "feature", feature: "approval automation", category: null, importance_hint: 0.9, confidence: 0.9, evidence: [] }],
      },
    } as unknown as QueryPlanningInput;
    const planFor = (sourceKey: string, queries: QueryPlanQuery[]): QueryPlan => ({
      version: "query_planning_v8", product_id: "product", demand_profile_version: "v2", source_routing_version: "source_routing_v1",
      scan_mode: "manual", overall_confidence: 0.9,
      source_plans: [{ source_key: sourceKey, priority: "high", candidate_budget: queries.reduce((sum, item) => sum + item.candidate_budget, 0), query_budget: queries.length, queries, excluded_query_families: [], reason_codes: [], confidence: 0.9 }],
      diagnostics: { source_count: 1, query_count: queries.length, query_family_distribution: {}, demand_surface_coverage: {}, queries_per_source: { [sourceKey]: queries.length }, candidate_budget_per_source: { [sourceKey]: queries.reduce((sum, item) => sum + item.candidate_budget, 0) }, suppressed_duplicate_count: 0, low_confidence: false, messages: [] },
    });
    const select = (sourceKey: string, queries: QueryPlanQuery[]) => diversifySignalQueries({
      plan: planFor(sourceKey, queries), planningInput: providerInput, candidatePool: [query(`pain-${sourceKey}`, "pain", "pain", 0.9, sourceKey), query(`feature-${sourceKey}`, "feature_requirement", "feature", 0.9, sourceKey)],
      history: [], historyState: "available", fingerprintForQuery: (row) => row.query_id,
    });
    const githubPain = query("pain-github", "pain", "pain", 0.9, "github");
    const githubFeature = query("feature-github", "feature_requirement", "feature", 0.9, "github");
    const githubSingle = select("github", [githubPain]);
    const xSingle = select("x", [query("pain-x", "pain", "pain", 0.9, "x")]);
    expect(githubSingle.plan.source_plans[0]?.queries[0]).toMatchObject({ query_id: "feature-github", intent_family: "feature_request" });
    expect(xSingle.plan.source_plans[0]?.queries[0]).toMatchObject({ query_id: "pain-x", intent_family: "pain_frustration" });
    const coldStart = select("github", [githubPain, githubFeature]);
    expect(coldStart.plan.source_plans[0]?.queries).toHaveLength(2);
    expect(new Set(coldStart.plan.source_plans[0]?.queries.map((item) => item.intent_family)).size).toBe(2);
    expect(coldStart.summary.familyCoverageBySource.github).toBe(2);
    expect(coldStart.summary.queryCountBefore).toBe(coldStart.summary.queryCountAfter);
  });
});

describe("Signal Query Exploration V1.1", () => {
  const pain = query("pain-query", "pain", "pain", 0.9);
  const feature = query("feature-query", "feature_requirement", "feature", 0.9);

  it("A: gives legitimate V8 cold-start variants a deterministic first-run exploration opportunity", () => {
    const result = v11(planFor([pain]), [pain, { ...feature, confidence: 0.95 }]);
    expect(result.plan.source_plans[0]?.queries).toHaveLength(1);
    expect(result.plan.source_plans[0]?.queries[0]).toMatchObject({ query_id: "feature-query", query_variant_version: signalQueryExplorationV11Version, novelty_state: "cold_start", selection_reason: "cold_start_exploration" });
    expect(result.summary.candidateCount).toBe(2);
    expect(result.summary.unselectedCandidateCount).toBe(1);
    expect(result.summary.noveltyStateCounts).toEqual({ cold_start: 2 });
  });

  it("B: rotates an immediately repeated zero-new-root query to a comparable unseen alternative", () => {
    const exhausted = history("pain-query", [{ scanRunId: "prior-scan", uniqueRoots: 5, newIndependentRoots: 0, completedAt: "2026-10-01T11:00:00.000Z" }]);
    const result = v11(planFor([pain]), [pain, feature], exhausted);
    expect(result.plan.source_plans[0]?.queries[0]).toMatchObject({ query_id: "feature-query", selection_reason: "unseen_variant_exploration" });
    expect(result.summary.immediatelyRepeatedCandidateCount).toBe(1);
    expect(result.summary.recentZeroNoveltyCandidateCount).toBe(1);
    expect(result.summary.immediatelyRepeatedSelectionCount).toBe(0);
    expect(result.summary.rotatedSelectionCount).toBe(1);
  });

  it("C/E: keeps the high-quality repeated query when unseen alternatives fall outside the confidence band", () => {
    const weak = query("weak-feature", "feature_requirement", "feature", 0.79);
    const prior = history("pain-query", [{ scanRunId: "prior-scan", uniqueRoots: 5, newIndependentRoots: 0, completedAt: "2026-10-01T11:00:00.000Z" }]);
    const result = v11(planFor([pain]), [pain, weak], prior);
    expect(result.plan.source_plans[0]?.queries[0]?.query_id).toBe("pain-query");
    expect(result.summary.unselectedCandidateCount).toBe(1);
  });

  it("D: produces the same recency rotation on every replay", () => {
    const prior = history("pain-query", [{ scanRunId: "latest-scan", uniqueRoots: 5, newIndependentRoots: 1, completedAt: "2026-10-01T11:00:00.000Z" }]);
    expect(v11(planFor([pain]), [pain, feature], prior)).toEqual(v11(planFor([pain]), [pain, feature], prior));
  });

  it("F: allows a query back into selection after its temporary freshness/zero-yield penalty expires", () => {
    const oldPain = history("pain-query", [{ scanRunId: "older-scan", uniqueRoots: 5, newIndependentRoots: 1, completedAt: "2026-09-20T11:00:00.000Z" }]);
    const latestFeature = history("feature-query", [{ scanRunId: "latest-scan", uniqueRoots: 5, newIndependentRoots: 0, completedAt: "2026-10-01T11:00:00.000Z" }]);
    const result = v11(planFor([feature]), [pain, feature], [...oldPain, ...latestFeature]);
    expect(result.plan.source_plans[0]?.queries[0]?.query_id).toBe("pain-query");
    expect(result.summary.candidatePoolBySource.github).toMatchObject({ validCandidates: 2, selected: 1, unselected: 1 });
  });

  it("G: retains the existing three-execution low-novelty policy as a non-excluding historical signal", () => {
    const persistent = history("pain-query", [
      { scanRunId: "scan-1", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-10-01T11:00:00.000Z" },
      { scanRunId: "scan-2", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T11:00:00.000Z" },
      { scanRunId: "scan-3", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-29T11:00:00.000Z" },
    ]);
    const result = v11(planFor([pain]), [pain, feature], persistent);
    expect(result.plan.source_plans[0]?.queries[0]?.query_id).toBe("feature-query");
    expect(result.summary.persistentLowNoveltyCandidateCount).toBe(1);
    expect(result.summary.candidatePoolBySource.github?.validCandidates).toBe(2);
    expect(queryNoveltyState(persistent, "pain-query")).toBe("low_novelty");
  });

  it("records when persistent low novelty caused a comparable query rotation", () => {
    const persistent = history("pain-query", [
      { scanRunId: "scan-1", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-10-01T11:00:00.000Z" },
      { scanRunId: "scan-2", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-30T11:00:00.000Z" },
      { scanRunId: "scan-3", uniqueRoots: 4, newIndependentRoots: 0, completedAt: "2026-09-29T11:00:00.000Z" },
    ]);
    const alternativeHistory = history("feature-query", [
      { scanRunId: "scan-0", uniqueRoots: 2, newIndependentRoots: 1, completedAt: "2026-09-30T10:00:00.000Z" },
    ]);
    const result = v11(planFor([pain]), [pain, feature], [...persistent, ...alternativeHistory]);
    expect(result.plan.source_plans[0]?.queries[0]).toMatchObject({
      query_id: "feature-query",
      selection_reason: "persistent_low_novelty_penalty",
    });
    expect(result.summary.persistentLowNoveltyCandidateCount).toBe(1);
  });

  it("H: uses bounded family coverage from only the three latest provider scans", () => {
    const rows: SignalQueryHistoryRow[] = [];
    for (const [index, day] of [[1, 1], [2, 2], [3, 3]] as const) {
      const scanRunId = `scan-${index}`;
      const completedAt = `2026-09-${String(28 - day).padStart(2, "0")}T11:00:00.000Z`;
      rows.push(...history("pain-query", [{ scanRunId, sourceKey: "github", intentFamily: "pain_frustration", uniqueRoots: 4, newIndependentRoots: 1, completedAt }]));
      rows.push(...history("feature-query", [{ scanRunId, sourceKey: "github", intentFamily: "unmet_need", uniqueRoots: 4, newIndependentRoots: 1, completedAt }]));
    }
    const result = v11(planFor([pain]), [pain, feature], rows);
    expect(result.plan.source_plans[0]?.queries[0]?.query_id).toBe("feature-query");
    expect(result.summary.familyCoverageBySource.github).toBe(1);
  });

  it("I/J: preserves per-provider slot count and exact candidate budgets", () => {
    const first = { ...pain, candidate_budget: 4 };
    const second = { ...feature, candidate_budget: 7 };
    const spare = { ...query("spare-query", "pain", "pain", 0.9), candidate_budget: 99 };
    const plan = planFor([first, second]);
    const result = v11(plan, [first, second, spare]);
    expect(result.plan.source_plans[0]?.queries).toHaveLength(2);
    expect(result.plan.source_plans[0]?.query_budget).toBe(2);
    expect(result.plan.source_plans[0]?.candidate_budget).toBe(plan.source_plans[0]?.candidate_budget);
    expect(result.plan.source_plans[0]?.queries.map((item) => item.candidate_budget)).toEqual([4, 7]);
    expect(result.summary.queryCountBefore).toBe(2);
    expect(result.summary.queryCountAfter).toBe(2);
  });

  it("K: carries selection annotations without changing provider request syntax", () => {
    const sourcePlan = planFor([pain]).source_plans[0]!;
    const before = toSourceDiscoveryRequest({ sourcePlan, query: pain, maxPages: 2 });
    const annotated = { ...pain, query_variant_version: signalQueryExplorationV11Version, selection_reason: "cold_start_exploration" as const, novelty_state: "cold_start" as const };
    const after = toSourceDiscoveryRequest({ sourcePlan, query: annotated, maxPages: 2 });
    expect(after.query).toEqual(before.query);
    expect(after.limit).toBe(before.limit);
    expect(after.requestMetadata).toMatchObject({ queryVariantVersion: signalQueryExplorationV11Version, querySelectionReason: "cold_start_exploration", queryNoveltyState: "cold_start" });
  });

  it("L/M: leaves evidence, qualification, provenance, dedupe and evaluation-backlog code outside the planner path", () => {
    const result = v11(planFor([pain]), [pain, feature]);
    const selected = result.plan.source_plans[0]?.queries[0];
    expect([pain, feature]).toContainEqual(expect.objectContaining({ query_id: selected?.query_id, query_text: selected?.query_text }));
    expect(result.plan.source_plans[0]?.queries[0]?.metadata).not.toHaveProperty("qualification_threshold");
    expect(result.plan.diagnostics.query_count).toBe(1);
  });

  it("O: reports cold_start and insufficient_history as separate states and counters", () => {
    const cold = diversifySignalQueries({ plan: planFor([pain]), planningInput, candidatePool: [pain], history: [], historyState: "available", fingerprintForQuery: (item) => item.query_id });
    const insufficient = diversifySignalQueries({ plan: planFor([pain]), planningInput, candidatePool: [pain], history: history("pain-query", [{ uniqueRoots: 2, newIndependentRoots: 1, completedAt: "2026-10-01T11:00:00.000Z" }]), historyState: "available", fingerprintForQuery: (item) => item.query_id });
    expect(cold.summary).toMatchObject({ coldStartQueryCount: 1, insufficientHistoryQueryCount: 0, historyUnavailableQueryCount: 0 });
    expect(insufficient.summary).toMatchObject({ coldStartQueryCount: 0, insufficientHistoryQueryCount: 1, historyUnavailableQueryCount: 0 });
  });
});
