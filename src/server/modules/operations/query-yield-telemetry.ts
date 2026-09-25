
export type QueryYieldExecutionStatus = "completed_with_results" | "completed_zero_results" | "rate_limited" | "provider_error" | "budget_limited" | "execution_suppressed" | "disabled" | "unavailable" | "degraded";
export type SourceHealthStatus = QueryYieldExecutionStatus | "not_planned" | "disabled" | "unavailable";
export type QueryYieldStopReason = "no_cursor" | "page_cap_reached" | "provider_limit" | "zero_results" | "error";

export type QueryYieldTelemetry = {
  queryPlanId: string; source: string; family: string; surface: string; concepts: string[]; competitorSpecific: boolean;
  pagesRequested: number; pagesCompleted: number; cursorContinuationCount: number; continuationStoppedReason: QueryYieldStopReason;
  executionStatus: QueryYieldExecutionStatus; rawItems: number; normalizedItems: number; uniqueConversations: number; duplicateCount: number;
  estimatedCostUsd: number | null;
  /**
   * Wanterest 1B Stage 2B (observational): the tenant-free market partition
   * this query's executed retrieval spec maps to, if the source is eligible.
   * Null for queries that never executed (reconciled fallback rows) and for
   * queries against an ineligible source - see marketPartitionIneligibleReason.
   */
  marketPartitionKey?: string | null;
  /** Set only when the source is not eligible for partition identity in v1. */
  marketPartitionIneligibleReason?: string | null;
  /**
   * Exact count of raw items newly inserted (not already-existing duplicates)
   * for this query, summed across its pages, taken directly from
   * IngestionService.discoverSource's own rawInserted field - not inferred.
   */
  rawNewItems?: number | null;
};

export type QueryYieldOutcome = { conversationId: string; selected: boolean; evaluated: boolean; qualificationStatus: "qualified" | "weak_candidate" | "rejected" | null };
export type QueryYieldProvenance = { conversationId: string; queryPlanId: string };
export type FinalizedQueryYieldTelemetry = QueryYieldTelemetry & { selectedCount: number; evaluatedCount: number; qualifiedInfluencedCount: number; weakInfluencedCount: number; rejectedInfluencedCount: number };

export type PlannedQueryYield = {
  queryPlanId: string;
  source: string;
  family: string;
  surface: string;
  concepts: string[];
  competitorSpecific: boolean;
};

export type QueryYieldSourceState = {
  source: string;
  status: "completed" | "failed" | "skipped";
  queryCount: number;
  errorCode?: string | null;
};

export type QueryYieldReconciliation = {
  rows: QueryYieldTelemetry[];
  plannedQueryCount: number;
  terminalQueryArtifactCount: number;
  missingQueryPlanIds: string[];
};

/**
 * A continuation is the cursor used to move from one completed page to the
 * next. A request capped at N pages can therefore have at most N - 1
 * continuations. Keep the persisted telemetry inside the schema's bound even
 * when a provider returns a cursor on the final page.
 */
export function boundedCursorContinuationCount(continuations: number, pagesRequested: number): number {
  const normalizedContinuations = Number.isFinite(continuations) ? Math.max(0, Math.floor(continuations)) : 0;
  const normalizedPages = Number.isFinite(pagesRequested) ? Math.max(0, Math.floor(pagesRequested)) : 0;
  return Math.min(normalizedContinuations, Math.max(0, normalizedPages - 1));
}

function terminalStatus(source: QueryYieldSourceState | undefined, plannedCount: number): { status: QueryYieldExecutionStatus; stop: QueryYieldStopReason } {
  if (source?.status === "failed") return source.errorCode === "RATE_LIMITED" ? { status: "rate_limited", stop: "error" } : { status: "provider_error", stop: "error" };
  if (source?.status === "skipped") return { status: source.errorCode === "CONFIGURATION_MISSING" ? "unavailable" : "disabled", stop: "error" };
  if (source && source.queryCount < plannedCount) return { status: "budget_limited", stop: "provider_limit" };
  return { status: "execution_suppressed", stop: "error" };
}

/** Ensures every planner query has exactly one immutable terminal telemetry row. */
export function reconcileQueryYieldTelemetry(planned: PlannedQueryYield[], executed: QueryYieldTelemetry[], sourceStates: QueryYieldSourceState[]): QueryYieldReconciliation {
  const executedById = new Map(executed.map((row) => [row.queryPlanId, row]));
  const sourceCounts = new Map<string, number>();
  for (const query of planned) sourceCounts.set(query.source, (sourceCounts.get(query.source) ?? 0) + 1);
  const rows = planned.map((query) => {
    const existing = executedById.get(query.queryPlanId);
    if (existing) return existing;
    const source = sourceStates.find((item) => item.source === query.source);
    const terminal = terminalStatus(source, sourceCounts.get(query.source) ?? 1);
    return {
      queryPlanId: query.queryPlanId,
      source: query.source,
      family: query.family,
      surface: query.surface,
      concepts: query.concepts,
      competitorSpecific: query.competitorSpecific,
      pagesRequested: 1,
      pagesCompleted: 0,
      cursorContinuationCount: 0,
      continuationStoppedReason: terminal.stop,
      executionStatus: terminal.status,
      rawItems: 0,
      normalizedItems: 0,
      uniqueConversations: 0,
      duplicateCount: 0,
      estimatedCostUsd: null,
    } satisfies QueryYieldTelemetry;
  });
  const rowIds = new Set(rows.map((row) => row.queryPlanId));
  return { rows, plannedQueryCount: planned.length, terminalQueryArtifactCount: rowIds.size, missingQueryPlanIds: planned.map((query) => query.queryPlanId).filter((id) => !rowIds.has(id)) };
}

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

export function sourceHealthStatus(input: { planned: boolean; executed: boolean; normalizedItems: number; executionStatus?: "completed" | "failed" | "skipped"; errorCode?: string | null; budgetLimited?: boolean; disabled?: boolean; unavailable?: boolean; degraded?: boolean }): SourceHealthStatus {
  if (!input.planned) return "not_planned";
  if (input.disabled) return "disabled";
  if (input.unavailable) return "unavailable";
  if (input.executionStatus === "failed") return input.errorCode === "RATE_LIMITED" ? "rate_limited" : "provider_error";
  if (input.budgetLimited) return "budget_limited";
  if (input.errorCode === "RATE_LIMITED") return "rate_limited";
  if (input.errorCode) return "provider_error";
  if (input.degraded) return "degraded";
  return input.normalizedItems > 0 ? "completed_with_results" : "completed_zero_results";
}
