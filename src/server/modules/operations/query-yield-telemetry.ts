export type QueryYieldExecutionStatus = "completed_with_results" | "completed_zero_results" | "rate_limited" | "provider_error" | "budget_limited" | "degraded";
export type SourceHealthStatus = QueryYieldExecutionStatus | "not_planned" | "disabled" | "unavailable";
export type QueryYieldStopReason = "no_cursor" | "page_cap_reached" | "provider_limit" | "zero_results" | "error";

export type QueryYieldTelemetry = {
  queryPlanId: string; source: string; family: string; surface: string; concepts: string[]; competitorSpecific: boolean;
  pagesRequested: number; pagesCompleted: number; cursorContinuationCount: number; continuationStoppedReason: QueryYieldStopReason;
  executionStatus: QueryYieldExecutionStatus; rawItems: number; normalizedItems: number; uniqueConversations: number; duplicateCount: number;
  estimatedCostUsd: number | null;
};

export type QueryYieldOutcome = { conversationId: string; selected: boolean; evaluated: boolean; qualificationStatus: "qualified" | "weak_candidate" | "rejected" | null };
export type QueryYieldProvenance = { conversationId: string; queryPlanId: string };
export type FinalizedQueryYieldTelemetry = QueryYieldTelemetry & { selectedCount: number; evaluatedCount: number; qualifiedInfluencedCount: number; weakInfluencedCount: number; rejectedInfluencedCount: number };

export function finalizeQueryYieldTelemetry(rows: QueryYieldTelemetry[], provenance: QueryYieldProvenance[], outcomes: Map<string, QueryYieldOutcome>): FinalizedQueryYieldTelemetry[] {
  const counts = new Map(rows.map((row) => [row.queryPlanId, { selectedCount: 0, evaluatedCount: 0, qualifiedInfluencedCount: 0, weakInfluencedCount: 0, rejectedInfluencedCount: 0 }]));
  for (const entry of provenance) {
    const outcome = outcomes.get(entry.conversationId); const count = counts.get(entry.queryPlanId);
    if (!outcome || !count) continue;
    if (outcome.selected) count.selectedCount += 1;
    if (outcome.evaluated) count.evaluatedCount += 1;
    if (outcome.qualificationStatus === "qualified") count.qualifiedInfluencedCount += 1;
    if (outcome.qualificationStatus === "weak_candidate") count.weakInfluencedCount += 1;
    if (outcome.qualificationStatus === "rejected") count.rejectedInfluencedCount += 1;
  }
  return rows.map((row) => ({ ...row, ...(counts.get(row.queryPlanId) ?? { selectedCount: 0, evaluatedCount: 0, qualifiedInfluencedCount: 0, weakInfluencedCount: 0, rejectedInfluencedCount: 0 }) }));
}

export function aggregateQueryYield(rows: Array<QueryYieldTelemetry & Partial<FinalizedQueryYieldTelemetry>>) {
  const aggregate = (key: (row: QueryYieldTelemetry) => string) => Object.fromEntries([...rows.reduce((groups, row) => {
    const value = groups.get(key(row)) ?? { queriesExecuted: 0, normalized: 0, unique: 0, selected: 0, evaluated: 0, qualifiedInfluenced: 0, weakInfluenced: 0, rejectedInfluenced: 0 };
    value.queriesExecuted += 1; value.normalized += row.normalizedItems; value.unique += row.uniqueConversations; value.selected += row.selectedCount ?? 0; value.evaluated += row.evaluatedCount ?? 0; value.qualifiedInfluenced += row.qualifiedInfluencedCount ?? 0; value.weakInfluenced += row.weakInfluencedCount ?? 0; value.rejectedInfluenced += row.rejectedInfluencedCount ?? 0;
    groups.set(key(row), value); return groups;
  }, new Map<string, { queriesExecuted: number; normalized: number; unique: number; selected: number; evaluated: number; qualifiedInfluenced: number; weakInfluenced: number; rejectedInfluenced: number }>())].map(([name, value]) => [name, { ...value, retrievalYield: value.queriesExecuted ? value.normalized / value.queriesExecuted : null, candidateYield: value.normalized ? value.selected / value.normalized : null, qualificationYield: value.evaluated ? value.qualifiedInfluenced / value.evaluated : null }]));
  return { bySource: aggregate((row) => row.source), bySurface: aggregate((row) => row.surface), bySourceSurface: aggregate((row) => `${row.source}:${row.surface}`) };
}

export function sourceHealthStatus(input: { planned: boolean; executed: boolean; normalizedItems: number; errorCode?: string | null; budgetLimited?: boolean; disabled?: boolean; unavailable?: boolean; degraded?: boolean }): SourceHealthStatus {
  if (!input.planned) return "not_planned";
  if (input.disabled) return "disabled";
  if (input.unavailable) return "unavailable";
  if (input.budgetLimited) return "budget_limited";
  if (input.errorCode === "RATE_LIMITED") return "rate_limited";
  if (input.errorCode) return "provider_error";
  if (input.degraded) return "degraded";
  return input.normalizedItems > 0 ? "completed_with_results" : "completed_zero_results";
}
