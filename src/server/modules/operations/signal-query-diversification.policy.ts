import type { QueryIntentFamily, QueryPlan, QueryPlanQuery, QueryPlanningInput } from "./query-planning.schemas";
import { queryIntentFamilyForCandidate } from "./signal-query-intent";
import { signalQueryDiversificationVersion } from "./query-planning.schemas";

export type SignalQueryHistoryRow = {
  scanRunId: string;
  queryPlanFingerprint: string;
  queryVariantVersion: string;
  executionStatus: string;
  uniqueRoots: number;
  newRootAttributions: number;
  newIndependentRoots: number;
  completedAt: string;
};

export type QueryNoveltyState = "cold_start" | "insufficient_history" | "observed" | "low_novelty";

export type SignalQueryDiversificationSummary = {
  historyState: "available" | "unavailable";
  queryCountBefore: number;
  queryCountAfter: number;
  penalizedQueryCount: number;
  coldStartQueryCount: number;
  familyCoverageBySource: Record<string, number>;
};

const DEFAULT_PROVIDER_INTENT_ORDER: QueryIntentFamily[] = [
  "pain_frustration", "unmet_need", "feature_request", "job_to_be_done", "switching_intent",
  "alternative_search", "replacement_substitute", "comparison_versus", "workaround_manual_workflow",
  "purchase_adoption", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment",
  "competitor_complaint", "category_dissatisfaction", "unclassified",
];

const PROVIDER_INTENT_ORDER: Record<string, QueryIntentFamily[]> = {
  github: ["feature_request", "workaround_manual_workflow", "job_to_be_done", "pain_frustration", "missing_integration", "switching_intent", "replacement_substitute", "comparison_versus", "alternative_search", "unmet_need", "pricing_wtp_friction", "cancellation_abandonment", "purchase_adoption", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  x: ["switching_intent", "alternative_search", "comparison_versus", "pain_frustration", "feature_request", "purchase_adoption", "workaround_manual_workflow", "unmet_need", "replacement_substitute", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment", "job_to_be_done", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  reddit: ["pain_frustration", "unmet_need", "workaround_manual_workflow", "switching_intent", "replacement_substitute", "alternative_search", "comparison_versus", "feature_request", "job_to_be_done", "pricing_wtp_friction", "cancellation_abandonment", "missing_integration", "purchase_adoption", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  "hacker-news": ["pain_frustration", "switching_intent", "comparison_versus", "feature_request", "alternative_search", "job_to_be_done", "workaround_manual_workflow", "unmet_need", "replacement_substitute", "purchase_adoption", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  bluesky: ["pain_frustration", "unmet_need", "purchase_adoption", "switching_intent", "comparison_versus", "alternative_search", "feature_request", "job_to_be_done", "workaround_manual_workflow", "replacement_substitute", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  "product-hunt": ["purchase_adoption", "alternative_search", "feature_request", "comparison_versus", "pain_frustration", "job_to_be_done", "unmet_need", "switching_intent", "replacement_substitute", "workaround_manual_workflow", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  "stack-exchange": ["missing_integration", "feature_request", "pain_frustration", "job_to_be_done", "switching_intent", "alternative_search", "workaround_manual_workflow", "unmet_need", "replacement_substitute", "comparison_versus", "pricing_wtp_friction", "cancellation_abandonment", "purchase_adoption", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  discourse: ["pain_frustration", "unmet_need", "feature_request", "job_to_be_done", "switching_intent", "workaround_manual_workflow", "missing_integration", "alternative_search", "replacement_substitute", "comparison_versus", "pricing_wtp_friction", "cancellation_abandonment", "purchase_adoption", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  "public-web": ["alternative_search", "switching_intent", "comparison_versus", "purchase_adoption", "pain_frustration", "pricing_wtp_friction", "replacement_substitute", "unmet_need", "feature_request", "job_to_be_done", "workaround_manual_workflow", "missing_integration", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  g2: ["replacement_substitute", "comparison_versus", "category_dissatisfaction", "pain_frustration", "pricing_wtp_friction", "alternative_search", "cancellation_abandonment", "feature_request", "unmet_need", "switching_intent", "missing_integration", "workaround_manual_workflow", "job_to_be_done", "purchase_adoption", "competitor_complaint", "unclassified"],
  trustpilot: ["category_dissatisfaction", "pain_frustration", "replacement_substitute", "comparison_versus", "pricing_wtp_friction", "alternative_search", "cancellation_abandonment", "unmet_need", "purchase_adoption", "feature_request", "switching_intent", "missing_integration", "workaround_manual_workflow", "job_to_be_done", "competitor_complaint", "unclassified"],
  youtube: ["switching_intent", "replacement_substitute", "comparison_versus", "feature_request", "pain_frustration", "purchase_adoption", "alternative_search", "job_to_be_done", "workaround_manual_workflow", "unmet_need", "missing_integration", "pricing_wtp_friction", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  gitlab: ["feature_request", "missing_integration", "pain_frustration", "job_to_be_done", "switching_intent", "workaround_manual_workflow", "alternative_search", "replacement_substitute", "comparison_versus", "unmet_need", "pricing_wtp_friction", "cancellation_abandonment", "purchase_adoption", "competitor_complaint", "category_dissatisfaction", "unclassified"],
  devto: ["job_to_be_done", "feature_request", "pain_frustration", "alternative_search", "switching_intent", "workaround_manual_workflow", "missing_integration", "unmet_need", "comparison_versus", "replacement_substitute", "purchase_adoption", "pricing_wtp_friction", "cancellation_abandonment", "competitor_complaint", "category_dissatisfaction", "unclassified"],
};

const LOW_NOVELTY_EXECUTIONS = 3;
const MIN_LOW_NOVELTY_ROOTS = 10;
const LOW_NOVELTY_RATE = 0.1;
const LOW_NOVELTY_PENALTY = 0.1;
const MAX_DIVERSITY_CONFIDENCE_GAP = 0.15;

function historyForQuery(rows: readonly SignalQueryHistoryRow[], fingerprint: string): SignalQueryHistoryRow[] {
  return rows
    .filter((row) => row.queryVariantVersion === signalQueryDiversificationVersion && row.queryPlanFingerprint === fingerprint)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || right.scanRunId.localeCompare(left.scanRunId));
}

export function queryNoveltyState(rows: readonly SignalQueryHistoryRow[], fingerprint: string): QueryNoveltyState {
  const recent = historyForQuery(rows, fingerprint).slice(0, LOW_NOVELTY_EXECUTIONS);
  if (!recent.length) return "cold_start";
  if (recent.length < LOW_NOVELTY_EXECUTIONS) return "insufficient_history";
  if (recent.some((row) => row.executionStatus !== "completed_with_results" || row.uniqueRoots <= 0)) return "observed";
  const totalRoots = recent.reduce((total, row) => total + row.uniqueRoots, 0);
  if (totalRoots < MIN_LOW_NOVELTY_ROOTS) return "insufficient_history";
  const newRoots = recent.reduce((total, row) => total + row.newRootAttributions, 0);
  return newRoots / totalRoots <= LOW_NOVELTY_RATE ? "low_novelty" : "observed";
}

function intentOrder(sourceKey: string, family: QueryIntentFamily): number {
  const order = PROVIDER_INTENT_ORDER[sourceKey] ?? DEFAULT_PROVIDER_INTENT_ORDER;
  const position = order.indexOf(family);
  return position < 0 ? order.length : position;
}

type RankedQuery = { query: QueryPlanQuery; fingerprint: string; novelty: QueryNoveltyState; adjustedConfidence: number };

function compareQueries(sourceKey: string, left: RankedQuery, right: RankedQuery): number {
  return right.adjustedConfidence - left.adjustedConfidence
    || intentOrder(sourceKey, left.query.intent_family ?? "unclassified") - intentOrder(sourceKey, right.query.intent_family ?? "unclassified")
    || (left.query.intent_family ?? "unclassified").localeCompare(right.query.intent_family ?? "unclassified")
    || left.query.query_id.localeCompare(right.query.query_id);
}

/**
 * Deterministic, per-provider slot replacement from the existing V8 candidate pool.
 * It never generates query text or changes per-provider query/candidate budgets.
 */
export function diversifySignalQueries(input: {
  plan: QueryPlan;
  planningInput: QueryPlanningInput;
  candidatePool: QueryPlanQuery[];
  history: readonly SignalQueryHistoryRow[];
  historyState: "available" | "unavailable";
  fingerprintForQuery: (query: QueryPlanQuery) => string;
}): { plan: QueryPlan; summary: SignalQueryDiversificationSummary } {
  const candidateBySource = new Map<string, QueryPlanQuery[]>();
  for (const query of input.candidatePool) candidateBySource.set(query.source_key, [...(candidateBySource.get(query.source_key) ?? []), query]);
  let penalizedQueryCount = 0;
  let coldStartQueryCount = 0;
  const familyCoverageBySource: Record<string, number> = {};

  const sourcePlans = input.plan.source_plans.map((source) => {
    const candidates = new Map<string, QueryPlanQuery>();
    for (const query of [...(candidateBySource.get(source.source_key) ?? []), ...source.queries]) candidates.set(query.query_id, query);
    const ranked: RankedQuery[] = [...candidates.values()].map((query) => {
      const intentFamily = queryIntentFamilyForCandidate(input.planningInput, query);
      const classified = { ...query, intent_family: intentFamily };
      const fingerprint = input.fingerprintForQuery(query);
      const novelty = input.historyState === "available" ? queryNoveltyState(input.history, fingerprint) : "cold_start";
      const penalty = novelty === "low_novelty" ? LOW_NOVELTY_PENALTY : 0;
      return {
        query: classified,
        fingerprint,
        novelty,
        adjustedConfidence: Math.max(0, query.confidence - penalty),
      };
    });
    const remaining = [...ranked].sort((left, right) => compareQueries(source.source_key, left, right));
    const selected: RankedQuery[] = [];
    const families = new Set<QueryIntentFamily>();
    while (selected.length < source.queries.length && remaining.length) {
      remaining.sort((left, right) => compareQueries(source.source_key, left, right));
      const best = remaining[0]!;
      const unseen = remaining.filter((row) => !families.has(row.query.intent_family ?? "unclassified")
        && row.adjustedConfidence >= best.adjustedConfidence - MAX_DIVERSITY_CONFIDENCE_GAP);
      const next = unseen[0] ?? best;
      selected.push(next);
      families.add(next.query.intent_family ?? "unclassified");
      remaining.splice(remaining.indexOf(next), 1);
    }
    if (selected.length !== source.queries.length) return source;
    for (const row of selected) {
      if (row.novelty === "low_novelty") penalizedQueryCount += 1;
      if (row.novelty === "cold_start" || row.novelty === "insufficient_history") coldStartQueryCount += 1;
    }
    familyCoverageBySource[source.source_key] = new Set(selected.map((row) => row.query.intent_family ?? "unclassified")).size;
    const budgets = source.queries.map((query) => query.candidate_budget);
    return {
      ...source,
      queries: selected.map((row, index) => ({
        ...row.query,
        candidate_budget: budgets[index] ?? row.query.candidate_budget,
        query_variant_version: signalQueryDiversificationVersion,
        metadata: {
          ...row.query.metadata,
          signal_query_diversification_version: signalQueryDiversificationVersion,
          intent_family: row.query.intent_family ?? "unclassified",
          query_variant_version: signalQueryDiversificationVersion,
          novelty_state: row.novelty,
        },
      })),
    };
  });

  const selectedQueries = sourcePlans.flatMap((source) => source.queries);
  const queryFamilyDistribution: Record<string, number> = {};
  const queriesPerSource: Record<string, number> = {};
  const candidateBudgetPerSource: Record<string, number> = {};
  for (const source of sourcePlans) {
    queriesPerSource[source.source_key] = source.queries.length;
    candidateBudgetPerSource[source.source_key] = source.queries.reduce((sum, query) => sum + query.candidate_budget, 0);
    for (const query of source.queries) queryFamilyDistribution[query.query_family] = (queryFamilyDistribution[query.query_family] ?? 0) + 1;
  }
  const plan: QueryPlan = {
    ...input.plan,
    // Keep the V8 planner marker so provider adapters retain their exact V8 behavior.
    source_plans: sourcePlans,
    diagnostics: {
      ...input.plan.diagnostics,
      query_count: selectedQueries.length,
      query_family_distribution: queryFamilyDistribution,
      queries_per_source: queriesPerSource,
      candidate_budget_per_source: candidateBudgetPerSource,
      messages: [...input.plan.diagnostics.messages, `Signal Query Diversification V1 selected ${selectedQueries.length} existing queries from the V8 candidate pool; history ${input.historyState}.`],
    },
  };
  return {
    plan,
    summary: {
      historyState: input.historyState,
      queryCountBefore: input.plan.source_plans.reduce((sum, source) => sum + source.queries.length, 0),
      queryCountAfter: selectedQueries.length,
      penalizedQueryCount,
      coldStartQueryCount,
      familyCoverageBySource,
    },
  };
}
