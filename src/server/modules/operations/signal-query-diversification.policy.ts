import {
  signalQueryDiversificationVersion,
  signalQueryExplorationV11Version,
  type QueryIntentFamily,
  type QueryPlan,
  type QueryPlanQuery,
  type QueryPlanningInput,
  type QuerySelectionReason,
  type QueryPlannerNoveltyState,
} from "./query-planning.schemas";
import { queryIntentFamilyForCandidate } from "./signal-query-intent";

export type SignalQueryHistoryRow = {
  scanRunId: string;
  sourceKey?: string;
  queryFamily?: string;
  intentFamily?: string;
  queryPlanFingerprint: string;
  queryVariantVersion: string;
  selectionReason?: string | null;
  noveltyState?: string | null;
  executionStatus: string;
  uniqueRoots: number;
  newRootAttributions: number;
  newIndependentRoots: number;
  evidenceEligibleRoots?: number;
  evidenceEligibilityKnownRoots?: number;
  newIndependentEvidenceEligibleRoots?: number;
  completedAt: string;
};

export type QueryNoveltyState = "cold_start" | "insufficient_history" | "observed" | "low_novelty";

export type SignalQueryDiversificationSummary = {
  historyState: "available" | "unavailable";
  queryCountBefore: number;
  queryCountAfter: number;
  penalizedQueryCount: number;
  coldStartQueryCount: number;
  insufficientHistoryQueryCount: number;
  historyUnavailableQueryCount: number;
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
const V11_MAX_QUALITY_CONFIDENCE_GAP = 0.1;
const V11_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const V11_FRESHNESS_PENALTY = 0.05;
const V11_RECENT_ZERO_ELIGIBLE_PENALTY = 0.07;

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
  let insufficientHistoryQueryCount = 0;
  let historyUnavailableQueryCount = 0;
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
      if (input.historyState === "unavailable") historyUnavailableQueryCount += 1;
      else if (row.novelty === "cold_start") coldStartQueryCount += 1;
      else if (row.novelty === "insufficient_history") insufficientHistoryQueryCount += 1;
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
      insufficientHistoryQueryCount,
      historyUnavailableQueryCount,
      familyCoverageBySource,
    },
  };
}

type V11CandidateHistory = {
  noveltyState: QueryPlannerNoveltyState;
  lastExecutedAt: string | null;
  recentlyExecuted: boolean;
  immediatelyRepeated: boolean;
  recentZeroNovelty: boolean;
  persistentLowNovelty: boolean;
  familyCoverage: number;
  historicalYield: number;
};

function v11HistoryForQuery(rows: readonly SignalQueryHistoryRow[], fingerprint: string): SignalQueryHistoryRow[] {
  return rows
    .filter((row) => (row.queryVariantVersion === signalQueryDiversificationVersion || row.queryVariantVersion === signalQueryExplorationV11Version)
      && row.queryPlanFingerprint === fingerprint)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || right.scanRunId.localeCompare(left.scanRunId));
}

function v11NoveltyState(rows: readonly SignalQueryHistoryRow[]): QueryPlannerNoveltyState {
  if (!rows.length) return "cold_start";
  const recent = rows.slice(0, LOW_NOVELTY_EXECUTIONS);
  if (recent.length < LOW_NOVELTY_EXECUTIONS) return "insufficient_history";
  if (recent.some((row) => row.executionStatus !== "completed_with_results" || row.uniqueRoots <= 0)) return "observed";
  const totalRoots = recent.reduce((total, row) => total + row.uniqueRoots, 0);
  if (totalRoots < MIN_LOW_NOVELTY_ROOTS) return "insufficient_history";
  const newRoots = recent.reduce((total, row) => total + row.newRootAttributions, 0);
  return newRoots / totalRoots <= LOW_NOVELTY_RATE ? "low_novelty" : "observed";
}

function v11CandidateHistory(input: {
  query: QueryPlanQuery;
  fingerprint: string;
  rows: readonly SignalQueryHistoryRow[];
  now: Date;
  latestSourceScanRunId: string | null;
}): V11CandidateHistory {
  const rows = v11HistoryForQuery(input.rows, input.fingerprint);
  const latest = rows[0] ?? null;
  const ageMs = latest ? input.now.getTime() - Date.parse(latest.completedAt) : Number.POSITIVE_INFINITY;
  const recentlyExecuted = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= V11_FRESHNESS_WINDOW_MS;
  const recentZeroNovelty = Boolean(latest
    && recentlyExecuted
    && latest.executionStatus === "completed_with_results"
    && latest.uniqueRoots > 0
    && latest.newIndependentRoots === 0);
  const noveltyState = v11NoveltyState(rows);

  const sourceRows = input.rows
    .filter((row) => row.sourceKey === input.query.source_key
      && (row.queryVariantVersion === signalQueryDiversificationVersion || row.queryVariantVersion === signalQueryExplorationV11Version))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || right.scanRunId.localeCompare(left.scanRunId));
  const recentRunIds: string[] = [];
  for (const row of sourceRows) {
    if (!recentRunIds.includes(row.scanRunId)) recentRunIds.push(row.scanRunId);
    if (recentRunIds.length === LOW_NOVELTY_EXECUTIONS) break;
  }
  const coveredRuns = new Set(sourceRows
    .filter((row) => recentRunIds.includes(row.scanRunId) && row.intentFamily === (input.query.intent_family ?? "unclassified"))
    .map((row) => row.scanRunId));
  const historicalYield = rows.reduce((total, row) => total + (
    row.evidenceEligibilityKnownRoots !== undefined && row.evidenceEligibilityKnownRoots > 0
      ? row.newIndependentEvidenceEligibleRoots ?? 0
      : row.newIndependentRoots
  ), 0);

  return {
    noveltyState,
    lastExecutedAt: latest?.completedAt ?? null,
    recentlyExecuted,
    immediatelyRepeated: Boolean(latest && latest.scanRunId === input.latestSourceScanRunId),
    recentZeroNovelty,
    persistentLowNovelty: noveltyState === "low_novelty",
    familyCoverage: coveredRuns.size,
    historicalYield,
  };
}

type V11RankedQuery = Omit<RankedQuery, "novelty"> & {
  novelty: QueryPlannerNoveltyState;
  v11History: V11CandidateHistory;
  wasInBaseline: boolean;
};

function compareV11Candidates(sourceKey: string, left: V11RankedQuery, right: V11RankedQuery): number {
  return Number(right.novelty === "cold_start") - Number(left.novelty === "cold_start")
    || Number(left.v11History.persistentLowNovelty) - Number(right.v11History.persistentLowNovelty)
    || Number(left.v11History.recentZeroNovelty) - Number(right.v11History.recentZeroNovelty)
    || Number(left.v11History.immediatelyRepeated) - Number(right.v11History.immediatelyRepeated)
    || Number(left.v11History.recentlyExecuted) - Number(right.v11History.recentlyExecuted)
    || (left.v11History.lastExecutedAt ?? "").localeCompare(right.v11History.lastExecutedAt ?? "")
    || left.v11History.familyCoverage - right.v11History.familyCoverage
    || right.v11History.historicalYield - left.v11History.historicalYield
    || right.adjustedConfidence - left.adjustedConfidence
    || right.query.confidence - left.query.confidence
    || intentOrder(sourceKey, left.query.intent_family ?? "unclassified") - intentOrder(sourceKey, right.query.intent_family ?? "unclassified")
    || (left.query.intent_family ?? "unclassified").localeCompare(right.query.intent_family ?? "unclassified")
    || left.query.query_id.localeCompare(right.query.query_id);
}

function selectionReasonForV11(input: {
  chosen: V11RankedQuery;
  chosenHistory: V11CandidateHistory;
  comparable: V11RankedQuery[];
}): QuerySelectionReason {
  const alternatives = input.comparable.filter((candidate) => candidate.fingerprint !== input.chosen.fingerprint);
  if (input.chosenHistory.noveltyState === "cold_start" && alternatives.some((candidate) => candidate.v11History.noveltyState !== "cold_start")) {
    return "unseen_variant_exploration";
  }
  if (!input.chosenHistory.persistentLowNovelty && alternatives.some((candidate) => candidate.v11History.persistentLowNovelty)) return "persistent_low_novelty_penalty";
  if (!input.chosenHistory.recentZeroNovelty && alternatives.some((candidate) => candidate.v11History.recentZeroNovelty)) return "recent_zero_novelty_rotation";
  if (!input.chosenHistory.immediatelyRepeated && !input.chosenHistory.recentlyExecuted
    && alternatives.some((candidate) => candidate.v11History.immediatelyRepeated || candidate.v11History.recentlyExecuted)) {
    return "recency_rotation";
  }
  if (alternatives.some((candidate) => candidate.v11History.familyCoverage > input.chosenHistory.familyCoverage)) {
    return "intent_coverage";
  }
  if (alternatives.some((candidate) => candidate.v11History.historicalYield < input.chosenHistory.historicalYield)) {
    return "historical_yield";
  }
  return input.chosenHistory.noveltyState === "cold_start" ? "cold_start_exploration" : "default_rank";
}

/**
 * V1.1 rotates only within existing per-provider query slots and an explicit confidence band.
 * It consumes the same V8 candidates as V1 and leaves provider, acquisition, and evaluation
 * budgets untouched. Callers must fall back to V1 when history is unavailable.
 */
export function exploreSignalQueriesV11(input: {
  plan: QueryPlan;
  planningInput: QueryPlanningInput;
  candidatePool: QueryPlanQuery[];
  history: readonly SignalQueryHistoryRow[];
  now?: Date;
  fingerprintForQuery: (query: QueryPlanQuery) => string;
}): { plan: QueryPlan; summary: SignalQueryExplorationV11Summary } {
  const now = input.now ?? new Date();
  const candidateBySource = new Map<string, QueryPlanQuery[]>();
  for (const query of input.candidatePool) candidateBySource.set(query.source_key, [...(candidateBySource.get(query.source_key) ?? []), query]);
  const selectedReasonCounts: Record<string, number> = {};
  const noveltyStateCounts: Record<string, number> = {};
  const selectedFamilyCoverageBySource: Record<string, number> = {};
  const familyCoverageHistoryBySource: Record<string, { zeroScansCandidates: number; oneScanCandidates: number; twoScansCandidates: number; threeScansCandidates: number }> = {};
  const candidatePoolBySource: Record<string, { validCandidates: number; selected: number; unselected: number }> = {};
  let persistentLowNoveltyCandidateCount = 0;
  let recentZeroNoveltyCandidateCount = 0;
  let recentlyExecutedCandidateCount = 0;
  let immediatelyRepeatedCandidateCount = 0;
  let previouslyExecutedCandidateCount = 0;
  let unseenCandidateCount = 0;
  let rotatedSelectionCount = 0;
  let immediatelyRepeatedSelectionCount = 0;

  const sourcePlans = input.plan.source_plans.map((source) => {
    const candidates = new Map<string, QueryPlanQuery>();
    for (const query of [...(candidateBySource.get(source.source_key) ?? []), ...source.queries]) candidates.set(query.query_id, query);
    const baselineIds = new Set(source.queries.map((query) => query.query_id));
    const sourceRows = input.history
      .filter((row) => row.sourceKey === source.source_key
        && (row.queryVariantVersion === signalQueryDiversificationVersion || row.queryVariantVersion === signalQueryExplorationV11Version))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || right.scanRunId.localeCompare(left.scanRunId));
    const latestSourceScanRunId = sourceRows[0]?.scanRunId ?? null;
    const ranked: V11RankedQuery[] = [...candidates.values()].map((query) => {
      const intentFamily = queryIntentFamilyForCandidate(input.planningInput, query);
      const classified = { ...query, intent_family: intentFamily };
      const fingerprint = input.fingerprintForQuery(query);
      const history = v11CandidateHistory({ query: classified, fingerprint, rows: input.history, now, latestSourceScanRunId });
      if (history.persistentLowNovelty) persistentLowNoveltyCandidateCount += 1;
      if (history.recentZeroNovelty) recentZeroNoveltyCandidateCount += 1;
      if (history.recentlyExecuted) recentlyExecutedCandidateCount += 1;
      if (history.immediatelyRepeated) immediatelyRepeatedCandidateCount += 1;
      if (history.noveltyState === "cold_start") unseenCandidateCount += 1;
      else previouslyExecutedCandidateCount += 1;
      noveltyStateCounts[history.noveltyState] = (noveltyStateCounts[history.noveltyState] ?? 0) + 1;
      return {
        query: classified,
        fingerprint,
        novelty: history.noveltyState,
        adjustedConfidence: query.confidence
          - (history.persistentLowNovelty ? LOW_NOVELTY_PENALTY : 0)
          - (history.recentZeroNovelty ? V11_RECENT_ZERO_ELIGIBLE_PENALTY : 0)
          - (history.recentlyExecuted ? V11_FRESHNESS_PENALTY : 0),
        v11History: history,
        wasInBaseline: baselineIds.has(query.query_id),
      };
    });
    familyCoverageHistoryBySource[source.source_key] = {
      zeroScansCandidates: ranked.filter((row) => row.v11History.familyCoverage === 0).length,
      oneScanCandidates: ranked.filter((row) => row.v11History.familyCoverage === 1).length,
      twoScansCandidates: ranked.filter((row) => row.v11History.familyCoverage === 2).length,
      threeScansCandidates: ranked.filter((row) => row.v11History.familyCoverage >= 3).length,
    };
    const remaining = [...ranked];
    const selected: Array<{ row: V11RankedQuery; reason: QuerySelectionReason }> = [];
    const families = new Set<QueryIntentFamily>();
    while (selected.length < source.queries.length && remaining.length) {
      const bestRawConfidence = Math.max(...remaining.map((row) => row.query.confidence));
      const comparable = remaining.filter((row) => row.query.confidence >= bestRawConfidence - V11_MAX_QUALITY_CONFIDENCE_GAP);
      comparable.sort((left, right) => compareV11Candidates(source.source_key, left, right));
      const best = comparable[0]!;
      const unseenFamily = comparable.filter((row) => !families.has(row.query.intent_family ?? "unclassified"));
      const chosen = unseenFamily[0] ?? best;
      const reason = selectionReasonForV11({
        chosen,
        chosenHistory: chosen.v11History,
        comparable,
      });
      selected.push({ row: chosen, reason });
      families.add(chosen.query.intent_family ?? "unclassified");
      remaining.splice(remaining.indexOf(chosen), 1);
      if (!baselineIds.has(chosen.query.query_id)) rotatedSelectionCount += 1;
      if (chosen.v11History.immediatelyRepeated) immediatelyRepeatedSelectionCount += 1;
    }
    candidatePoolBySource[source.source_key] = {
      validCandidates: candidates.size,
      selected: selected.length,
      unselected: Math.max(0, candidates.size - selected.length),
    };
    if (selected.length !== source.queries.length) return source;
    selectedFamilyCoverageBySource[source.source_key] = new Set(selected.map(({ row }) => row.query.intent_family ?? "unclassified")).size;
    const budgets = source.queries.map((query) => query.candidate_budget);
    return {
      ...source,
      queries: selected.map(({ row, reason }, index) => {
        selectedReasonCounts[reason] = (selectedReasonCounts[reason] ?? 0) + 1;
        return {
          ...row.query,
          candidate_budget: budgets[index] ?? row.query.candidate_budget,
          query_variant_version: signalQueryExplorationV11Version,
          selection_reason: reason,
          novelty_state: row.v11History.noveltyState,
          metadata: {
            ...row.query.metadata,
            signal_query_diversification_version: signalQueryExplorationV11Version,
            signal_query_selection_reason: reason,
            intent_family: row.query.intent_family ?? "unclassified",
            query_variant_version: signalQueryExplorationV11Version,
            novelty_state: row.v11History.noveltyState,
          },
        };
      }),
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
    source_plans: sourcePlans,
    diagnostics: {
      ...input.plan.diagnostics,
      query_count: selectedQueries.length,
      query_family_distribution: queryFamilyDistribution,
      queries_per_source: queriesPerSource,
      candidate_budget_per_source: candidateBudgetPerSource,
      messages: [...input.plan.diagnostics.messages, `Signal Query Exploration V1.1 selected ${selectedQueries.length} existing queries from the V8 candidate pool; confidence band ${V11_MAX_QUALITY_CONFIDENCE_GAP.toFixed(2)}.`],
    },
  };
  const queryCountBefore = input.plan.source_plans.reduce((sum, source) => sum + source.queries.length, 0);
  return {
    plan,
    summary: {
      historyState: "available",
      queryCountBefore,
      queryCountAfter: selectedQueries.length,
      candidateCount: [...candidateBySource.values()].reduce((sum, rows) => sum + rows.length, 0),
      unselectedCandidateCount: Object.values(candidatePoolBySource).reduce((sum, row) => sum + row.unselected, 0),
      persistentLowNoveltyCandidateCount,
      recentlyExecutedCandidateCount,
      recentZeroNoveltyCandidateCount,
      immediatelyRepeatedCandidateCount,
      previouslyExecutedCandidateCount,
      unseenCandidateCount,
      rotatedSelectionCount,
      immediatelyRepeatedSelectionCount,
      selectedReasonCounts,
      noveltyStateCounts,
      candidatePoolBySource,
      familyCoverageBySource: selectedFamilyCoverageBySource,
      familyCoverageHistoryBySource,
    },
  };
}

export type SignalQueryExplorationV11Summary = {
  historyState: "available";
  queryCountBefore: number;
  queryCountAfter: number;
  candidateCount: number;
  unselectedCandidateCount: number;
  persistentLowNoveltyCandidateCount: number;
  recentlyExecutedCandidateCount: number;
  recentZeroNoveltyCandidateCount: number;
  immediatelyRepeatedCandidateCount: number;
  previouslyExecutedCandidateCount: number;
  unseenCandidateCount: number;
  rotatedSelectionCount: number;
  immediatelyRepeatedSelectionCount: number;
  selectedReasonCounts: Record<string, number>;
  noveltyStateCounts: Record<string, number>;
  candidatePoolBySource: Record<string, { validCandidates: number; selected: number; unselected: number }>;
  familyCoverageHistoryBySource: Record<string, { zeroScansCandidates: number; oneScanCandidates: number; twoScansCandidates: number; threeScansCandidates: number }>;
  familyCoverageBySource: Record<string, number>;
};
