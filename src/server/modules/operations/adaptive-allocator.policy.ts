import type { QueryPlan, QueryPlanQuery } from "./query-planning.schemas";
import { ADAPTIVE_ALLOCATOR_VERSION, type AdaptiveAllocatorMode } from "./adaptive-allocator.config";
import type {
  AdaptiveAllocatorAllocationSnapshot,
  AdaptiveAllocatorHistoryRow,
  AdaptiveAllocatorReasonCode,
  AdaptiveAllocatorSourceState,
  AdaptiveAllocatorSurface,
  AdaptiveAllocatorTelemetry,
} from "./adaptive-allocator.schemas";

const PRIOR_WEIGHT = 4;
const PRIOR_QUALIFIED_RATE = 0.05;
const PRIOR_CANDIDATE_RATE = 0.15;
const RECENCY_HALF_LIFE_DAYS = 30;
const EVALUATION_CAP = 15;

type MutableStats = {
  rows: number;
  weightedSample: number;
  qualified: number;
  retrievalUnits: number;
  selected: number;
  unique: number;
  normalized: number;
  duplicates: number;
  evaluated: number;
  recentQualified: number;
  recentEvaluated: number;
  olderQualified: number;
  olderEvaluated: number;
};

export type AdaptiveAllocatorPolicyInput = {
  plan: QueryPlan;
  history: readonly AdaptiveAllocatorHistoryRow[];
  sourceStates: readonly AdaptiveAllocatorSourceState[];
  mode: AdaptiveAllocatorMode;
  rotationSeed: string;
  now?: Date;
  historyWindowDays?: number;
};

export type AdaptiveAllocatorPolicyResult = {
  plan: QueryPlan;
  telemetry: AdaptiveAllocatorTelemetry;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
}

function roundNonnegative(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotationRank(seed: string, queryPlanId: string): number {
  return stableHash(`${seed}:${queryPlanId}`);
}

function emptyStats(): MutableStats {
  return { rows: 0, weightedSample: 0, qualified: 0, retrievalUnits: 0, selected: 0, unique: 0, normalized: 0, duplicates: 0, evaluated: 0, recentQualified: 0, recentEvaluated: 0, olderQualified: 0, olderEvaluated: 0 };
}

function healthFactor(state: AdaptiveAllocatorSourceState | undefined): number {
  if (!state || state.healthStatus === "unknown") return 0.95;
  if (state.healthStatus === "degraded") return 0.8;
  if (state.healthStatus === "blocked" || state.healthStatus === "unavailable" || state.controlState !== "enabled" || !state.configured) return 0;
  return 1;
}

function healthExcluded(state: AdaptiveAllocatorSourceState | undefined): boolean {
  return Boolean(state && (!state.configured || state.controlState !== "enabled" || ["blocked", "unavailable"].includes(state.healthStatus)));
}

function sourceStateMap(states: readonly AdaptiveAllocatorSourceState[]): Map<string, AdaptiveAllocatorSourceState> {
  return new Map(states.map((state) => [state.sourceKey, state]));
}

function collectStats(history: readonly AdaptiveAllocatorHistoryRow[], now: Date): Map<string, MutableStats> {
  const stats = new Map<string, MutableStats>();
  for (const row of history) {
    const current = stats.get(row.queryPlanId) ?? emptyStats();
    const ageDays = Math.max(0, (now.getTime() - new Date(row.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    const recency = Number.isFinite(ageDays) ? Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS) : 0.1;
    const recent = ageDays <= 14;
    current.rows += 1;
    current.weightedSample += recency * Math.max(1, row.evaluatedCount + row.uniqueConversations * 0.25);
    current.qualified += recency * row.qualifiedInfluencedCount;
    current.retrievalUnits += recency * Math.max(1, row.pagesRequested);
    current.selected += recency * row.selectedCount;
    current.unique += recency * row.uniqueConversations;
    current.normalized += recency * row.normalizedItems;
    current.duplicates += recency * row.duplicateCount;
    current.evaluated += recency * row.evaluatedCount;
    if (recent) {
      current.recentQualified += row.qualifiedInfluencedCount;
      current.recentEvaluated += row.evaluatedCount;
    } else {
      current.olderQualified += row.qualifiedInfluencedCount;
      current.olderEvaluated += row.evaluatedCount;
    }
    stats.set(row.queryPlanId, current);
  }
  return stats;
}

function reasonCodes(stats: MutableStats | undefined, score: number, state: AdaptiveAllocatorSourceState | undefined): AdaptiveAllocatorReasonCode[] {
  const reasons: AdaptiveAllocatorReasonCode[] = [];
  if (!stats?.rows) reasons.push("NEUTRAL_COLD_START", "LOW_SAMPLE_EXPLORATION");
  else {
    const confidence = clamp(Math.sqrt(stats.weightedSample / 16));
    if (stats.qualified > 0 && score >= 0.55) reasons.push("HIGH_QUALIFIED_YIELD");
    if (confidence < 0.5) reasons.push("LOW_SAMPLE_EXPLORATION");
    if (stats.evaluated > 0 && stats.qualified / stats.evaluated < 0.05) reasons.push("LOW_EVALUATION_EFFICIENCY");
    if (stats.duplicates / Math.max(1, stats.duplicates + stats.normalized) >= 0.35) reasons.push("HIGH_DUPLICATE_RATE");
    const recentRate = stats.recentQualified / Math.max(1, stats.recentEvaluated);
    const olderRate = stats.olderQualified / Math.max(1, stats.olderEvaluated);
    if (recentRate > olderRate + 0.1) reasons.push("RECENT_YIELD_IMPROVEMENT");
  }
  if (healthExcluded(state)) reasons.push("SOURCE_HEALTH_SUPPRESSION");
  return [...new Set(reasons)];
}

function surfaceFor(query: QueryPlanQuery, stats: MutableStats | undefined, state: AdaptiveAllocatorSourceState | undefined): AdaptiveAllocatorSurface {
  const rows = stats?.rows ?? 0;
  const weightedSample = stats?.weightedSample ?? 0;
  const qualified = stats?.qualified ?? 0;
  const retrievalUnits = stats?.retrievalUnits ?? 0;
  const evaluated = stats?.evaluated ?? 0;
  const unique = stats?.unique ?? 0;
  const selected = stats?.selected ?? 0;
  const normalized = stats?.normalized ?? 0;
  const duplicateRate = (stats?.duplicates ?? 0) / Math.max(1, (stats?.duplicates ?? 0) + normalized);
  const qualifiedRate = (qualified + PRIOR_QUALIFIED_RATE * PRIOR_WEIGHT) / Math.max(1, evaluated + PRIOR_WEIGHT);
  const qualifiedPerRetrievalUnit = (qualified + PRIOR_QUALIFIED_RATE * PRIOR_WEIGHT) / Math.max(1, retrievalUnits + PRIOR_WEIGHT);
  const candidateYield = rows ? clamp((selected + PRIOR_CANDIDATE_RATE * PRIOR_WEIGHT) / Math.max(1, unique + PRIOR_WEIGHT)) : null;
  const evaluationEfficiency = rows ? clamp(qualifiedRate) : null;
  const observedScore = clamp(0.55 * qualifiedPerRetrievalUnit + 0.3 * qualifiedRate + 0.1 * (candidateYield ?? PRIOR_CANDIDATE_RATE) + 0.05 * (1 - duplicateRate));
  const confidence = rows ? clamp(Math.sqrt(weightedSample / 16)) : 0;
  const score = round((0.5 + confidence * (observedScore - 0.5)) * healthFactor(state));
  return {
    queryPlanId: query.query_id,
    sourceKey: query.source_key,
    queryFamily: query.query_family,
    demandSurface: query.demand_surface,
    competitorSpecific: query.competitor_specific,
    candidateBudget: query.candidate_budget,
    score,
    sampleSize: round(weightedSample),
    confidence: round(confidence),
    historicalRows: rows,
    qualifiedEvidence: roundNonnegative(qualified),
    qualifiedEvidencePerRetrievalUnit: round(qualifiedPerRetrievalUnit),
    candidateYield,
    evaluationEfficiency,
    duplicateRate: round(duplicateRate),
    reasonCodes: reasonCodes(stats, score, state),
  };
}

function currentQueries(plan: QueryPlan): QueryPlanQuery[] {
  return plan.source_plans.flatMap((source) => source.queries).filter((query) => query.candidate_budget > 0);
}

function snapshot(plan: QueryPlan, budgets?: Map<string, number>): AdaptiveAllocatorAllocationSnapshot {
  const byQuery: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byPartition: Record<string, number> = {};
  let totalCandidateSlots = 0;
  for (const source of plan.source_plans) {
    for (const query of source.queries) {
      const value = budgets?.get(query.query_id) ?? query.candidate_budget;
      byQuery[query.query_id] = value;
      bySource[query.source_key] = (bySource[query.source_key] ?? 0) + value;
      const partition = typeof query.metadata.market_partition_key === "string" && query.metadata.market_partition_key ? query.metadata.market_partition_key : "unassigned";
      byPartition[partition] = (byPartition[partition] ?? 0) + value;
      totalCandidateSlots += value;
    }
  }
  return { totalQueryCount: Object.keys(byQuery).length, totalCandidateSlots, byQuery, bySource, byPartition };
}

function proposedBudgets(plan: QueryPlan, surfaces: Map<string, AdaptiveAllocatorSurface>, seed: string): { budgets: Map<string, number>; explorationAllocations: number; diversityFloorAllocations: number; competitorMixConstrained: boolean } {
  const budgets = new Map<string, number>();
  let explorationAllocations = 0;
  let diversityFloorAllocations = 0;
  let competitorMixConstrained = false;
  for (const source of plan.source_plans) {
    const queries = source.queries.filter((query) => query.candidate_budget > 0);
    if (!queries.length) continue;
    const total = queries.reduce((sum, query) => sum + query.candidate_budget, 0);
    const competitors = queries.filter((query) => query.competitor_specific || ["switching", "alternative_search", "competitor_pain"].includes(query.demand_surface));
    const nonCompetitors = queries.filter((query) => !competitors.includes(query));
    for (const query of competitors) budgets.set(query.query_id, query.candidate_budget);
    if (competitors.length && nonCompetitors.length) competitorMixConstrained = true;
    if (nonCompetitors.length === 0 || total - competitors.reduce((sum, query) => sum + query.candidate_budget, 0) < nonCompetitors.length) {
      for (const query of nonCompetitors) budgets.set(query.query_id, query.candidate_budget);
      continue;
    }
    let remaining = total - competitors.reduce((sum, query) => sum + query.candidate_budget, 0);
    for (const query of nonCompetitors) {
      budgets.set(query.query_id, 1);
      remaining -= 1;
      diversityFloorAllocations += 1;
      if ((surfaces.get(query.query_id)?.reasonCodes ?? []).some((code) => code === "NEUTRAL_COLD_START" || code === "LOW_SAMPLE_EXPLORATION")) explorationAllocations += 1;
    }
    const ordered = [...nonCompetitors].sort((left, right) => {
      const leftSurface = surfaces.get(left.query_id);
      const rightSurface = surfaces.get(right.query_id);
      const leftScore = (leftSurface?.score ?? 0.5) + (1 - (leftSurface?.confidence ?? 0)) * 0.05;
      const rightScore = (rightSurface?.score ?? 0.5) + (1 - (rightSurface?.confidence ?? 0)) * 0.05;
      return rightScore - leftScore || rotationRank(seed, left.query_id) - rotationRank(seed, right.query_id) || left.query_id.localeCompare(right.query_id);
    });
    const maxPerQuery = Math.max(1, source.candidate_budget);
    while (remaining > 0 && ordered.length) {
      const query = ordered.find((candidate) => (budgets.get(candidate.query_id) ?? 0) < maxPerQuery);
      if (!query) break;
      const current = budgets.get(query.query_id) ?? 0;
      budgets.set(query.query_id, current + 1);
      remaining -= 1;
    }
  }
  return { budgets, explorationAllocations, diversityFloorAllocations, competitorMixConstrained };
}

function applyBudgets(plan: QueryPlan, budgets: Map<string, number>, surfaces: Map<string, AdaptiveAllocatorSurface>, seed: string): QueryPlan {
  return {
    ...plan,
    source_plans: plan.source_plans.map((source) => ({
      ...source,
      queries: [...source.queries]
        .sort((left, right) => (surfaces.get(right.query_id)?.score ?? 0.5) - (surfaces.get(left.query_id)?.score ?? 0.5) || rotationRank(seed, left.query_id) - rotationRank(seed, right.query_id) || left.query_id.localeCompare(right.query_id))
        .map((query) => ({ ...query, candidate_budget: budgets.get(query.query_id) ?? query.candidate_budget })),
    })),
  };
}

export function buildAdaptiveAllocatorPlan(input: AdaptiveAllocatorPolicyInput): AdaptiveAllocatorPolicyResult {
  const started = Date.now();
  const now = input.now ?? new Date();
  const sourceStates = sourceStateMap(input.sourceStates);
  const queries = currentQueries(input.plan);
  const stats = collectStats(input.history, now);
  const surfaces = new Map(queries.map((query) => [query.query_id, surfaceFor(query, stats.get(query.query_id), sourceStates.get(query.source_key))]));
  const proposal = proposedBudgets(input.plan, surfaces, input.rotationSeed);
  const baseline = snapshot(input.plan);
  const proposed = snapshot(input.plan, proposal.budgets);
  const appliedPlan = input.mode === "active" ? applyBudgets(input.plan, proposal.budgets, surfaces, input.rotationSeed) : input.plan;
  const applied = snapshot(appliedPlan);
  const queriesShifted = Object.keys(baseline.byQuery).filter((queryId) => baseline.byQuery[queryId] !== proposed.byQuery[queryId]).length;
  const totalQualified = input.history.reduce((sum, row) => sum + row.qualifiedInfluencedCount, 0);
  const totalEvaluated = input.history.reduce((sum, row) => sum + row.evaluatedCount, 0);
  const totalSelected = input.history.reduce((sum, row) => sum + row.selectedCount, 0);
  const totalUnique = input.history.reduce((sum, row) => sum + row.uniqueConversations, 0);
  const sourceHealthExclusions = input.sourceStates.filter((state) => healthExcluded(state)).map((state) => `${state.sourceKey}:${state.healthStatus}`).sort();
  const historicalSurfaces = queries.filter((query) => (stats.get(query.query_id)?.rows ?? 0) > 0).map((query) => query.query_id).sort();
  const coldStartSurfaces = queries.filter((query) => (stats.get(query.query_id)?.rows ?? 0) === 0).map((query) => query.query_id).sort();
  const warnings = [
    ...(Object.keys(baseline.byPartition).length === 1 && baseline.byPartition.unassigned ? ["Partition identity is not available before provider request construction; partition allocation remains observational in V1."] : []),
    ...(proposal.competitorMixConstrained ? ["Competitor query slots were held at baseline because planner-selected non-competitor supply exists."] : []),
  ];
  const telemetry: AdaptiveAllocatorTelemetry = {
    version: ADAPTIVE_ALLOCATOR_VERSION,
    mode: input.mode,
    historyWindowDays: input.historyWindowDays ?? 90,
    historyRowsRead: input.history.length,
    eligibleSurfaceCount: queries.length,
    historicalSurfaceCount: historicalSurfaces.length,
    coldStartSurfaceCount: coldStartSurfaces.length,
    eligibleSurfaces: queries.map((query) => query.query_id).sort(),
    historicalSurfaces,
    coldStartSurfaces,
    baselineAllocation: baseline,
    proposedAllocation: proposed,
    appliedAllocation: applied,
    surfaceScores: [...surfaces.values()].sort((left, right) => left.queryPlanId.localeCompare(right.queryPlanId)),
    queriesShifted,
    sourceAllocationBefore: baseline.bySource,
    sourceAllocationAfter: applied.bySource,
    partitionAllocationBefore: baseline.byPartition,
    partitionAllocationAfter: applied.byPartition,
    qualifiedEvidenceHistoricalYield: totalQualified,
    candidateHistoricalYield: totalUnique ? round(totalSelected / totalUnique) : null,
    evaluationEfficiency: totalEvaluated ? round(totalQualified / totalEvaluated) : null,
    sampleConfidence: round(Math.min(1, Math.sqrt((totalEvaluated + totalUnique * 0.25) / 16))),
    explorationAllocations: proposal.explorationAllocations,
    diversityFloorAllocations: proposal.diversityFloorAllocations,
    sourceHealthExclusions,
    capPressure: { queryCap: input.plan.diagnostics.query_count, candidateCap: baseline.totalCandidateSlots, evaluationCap: EVALUATION_CAP, queryCapSkips: 0, candidateCapSkips: 0, evaluationCapSkips: 0, competitorMixConstrained: proposal.competitorMixConstrained },
    computationDurationMs: Math.max(0, Date.now() - started),
    warnings,
    errors: [],
  };
  return { plan: appliedPlan, telemetry };
}

export function buildAdaptiveAllocatorOffTelemetry(plan: QueryPlan, sourceStates: readonly AdaptiveAllocatorSourceState[] = []): AdaptiveAllocatorTelemetry {
  const baseline = snapshot(plan);
  const sourceHealthExclusions = sourceStates.filter((state) => healthExcluded(state)).map((state) => `${state.sourceKey}:${state.healthStatus}`).sort();
  return {
    version: ADAPTIVE_ALLOCATOR_VERSION,
    mode: "off",
    historyWindowDays: 90,
    historyRowsRead: 0,
    eligibleSurfaceCount: baseline.totalQueryCount,
    historicalSurfaceCount: 0,
    coldStartSurfaceCount: 0,
    eligibleSurfaces: Object.keys(baseline.byQuery).sort(),
    historicalSurfaces: [],
    coldStartSurfaces: [],
    baselineAllocation: baseline,
    proposedAllocation: baseline,
    appliedAllocation: baseline,
    surfaceScores: [],
    queriesShifted: 0,
    sourceAllocationBefore: baseline.bySource,
    sourceAllocationAfter: baseline.bySource,
    partitionAllocationBefore: baseline.byPartition,
    partitionAllocationAfter: baseline.byPartition,
    qualifiedEvidenceHistoricalYield: 0,
    candidateHistoricalYield: null,
    evaluationEfficiency: null,
    sampleConfidence: 0,
    explorationAllocations: 0,
    diversityFloorAllocations: 0,
    sourceHealthExclusions,
    capPressure: { queryCap: plan.diagnostics.query_count, candidateCap: baseline.totalCandidateSlots, evaluationCap: EVALUATION_CAP, queryCapSkips: 0, candidateCapSkips: 0, evaluationCapSkips: 0, competitorMixConstrained: false },
    computationDurationMs: 0,
    warnings: [],
    errors: [],
  };
}
