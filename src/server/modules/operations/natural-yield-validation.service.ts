import "server-only";

import {
  NATURAL_YIELD_MAX_DAYS,
  type AllocatorShadowSummary,
  type DailyNaturalYield,
  naturalYieldMeasurability,
  type NaturalYieldInput,
  type NaturalYieldJobRow,
  type NaturalYieldReport,
  type NaturalYieldSurface,
  type RoutingShadowSummary,
} from "./natural-yield-validation.schemas";

type RecordValue = Record<string, unknown>;

const QUALITY_REVIEW_DIMENSIONS = [
  "SUPPORTED_BY_SOURCE",
  "INTENT_CORRECT",
  "TARGET_CORRECT",
  "TEMPORAL_CORRECT",
  "COMPETITOR_SPECIFIC_CORRECT",
  "PROVENANCE_COMPLETE",
] as const;

function recordValue(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function dateKey(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function windowDates(since: string, until: string): string[] {
  const start = new Date(since);
  const end = new Date(until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("Natural yield window must contain valid increasing ISO timestamps.");
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > NATURAL_YIELD_MAX_DAYS) throw new Error(`Natural yield window cannot exceed ${NATURAL_YIELD_MAX_DAYS} days.`);
  const result: string[] = [];
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) result.push(cursor.toISOString().slice(0, 10));
  return result;
}

function inWindow(value: string, since: string, until: string): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= new Date(since).getTime() && timestamp < new Date(until).getTime();
}

function emptyDay(date: string): DailyNaturalYield {
  return {
    date, scans: 0, plannedQueries: 0, executedQueries: 0, sourcesAttempted: [], partitionsObserved: [], rawItems: 0,
    rawNewItems: null, normalizedItems: 0, queryScopedUniqueConversations: 0, duplicateItems: 0, selectedCandidates: 0,
    evaluations: 0, qualifiedEvaluations: 0, weakCandidates: 0, rejectedCandidates: 0, qualifiedEvidence: 0, newSignals: 0,
    strengthenedSignals: null, distinctDemandEpisodes: null, providerRequests: null, providerFailures: 0, rateLimitSkips: 0,
    evaluationCapPressure: 0,
  };
}

function addUnique(target: string[], value: string | null | undefined): void {
  if (value && !target.includes(value)) target.push(value);
}

function sumDays(days: DailyNaturalYield[], label: string): DailyNaturalYield {
  const result = emptyDay(label);
  const rawNew = days.map((day) => day.rawNewItems).filter((value): value is number => value !== null);
  result.scans = new Set(days.flatMap((day) => Array.from({ length: day.scans }, (_, index) => `${day.date}:${index}`))).size;
  result.plannedQueries = days.reduce((sum, day) => sum + day.plannedQueries, 0);
  result.executedQueries = days.reduce((sum, day) => sum + day.executedQueries, 0);
  result.rawItems = days.reduce((sum, day) => sum + day.rawItems, 0);
  result.rawNewItems = rawNew.length === days.length ? rawNew.reduce((sum, value) => sum + value, 0) : null;
  result.normalizedItems = days.reduce((sum, day) => sum + day.normalizedItems, 0);
  result.queryScopedUniqueConversations = days.reduce((sum, day) => sum + day.queryScopedUniqueConversations, 0);
  result.duplicateItems = days.reduce((sum, day) => sum + day.duplicateItems, 0);
  result.selectedCandidates = days.reduce((sum, day) => sum + day.selectedCandidates, 0);
  result.evaluations = days.reduce((sum, day) => sum + day.evaluations, 0);
  result.qualifiedEvaluations = days.reduce((sum, day) => sum + day.qualifiedEvaluations, 0);
  result.weakCandidates = days.reduce((sum, day) => sum + day.weakCandidates, 0);
  result.rejectedCandidates = days.reduce((sum, day) => sum + day.rejectedCandidates, 0);
  result.qualifiedEvidence = days.reduce((sum, day) => sum + day.qualifiedEvidence, 0);
  result.newSignals = days.reduce((sum, day) => sum + day.newSignals, 0);
  result.providerFailures = days.reduce((sum, day) => sum + day.providerFailures, 0);
  result.rateLimitSkips = days.reduce((sum, day) => sum + day.rateLimitSkips, 0);
  result.evaluationCapPressure = days.reduce((sum, day) => sum + day.evaluationCapPressure, 0);
  result.sourcesAttempted = [...new Set(days.flatMap((day) => day.sourcesAttempted))].sort();
  result.partitionsObserved = [...new Set(days.flatMap((day) => day.partitionsObserved))].sort();
  return result;
}

function allocationEquals(left: unknown, right: unknown): boolean {
  const a = recordValue(left); const b = recordValue(right);
  if (!a || !b) return false;
  const canonical = (value: RecordValue) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))));
  return canonical(a) === canonical(b);
}

function allocatorTelemetry(job: NaturalYieldJobRow): RecordValue | null {
  const root = recordValue(job.inputReference);
  const result = recordValue(root?.result);
  const telemetry = recordValue(result?.adaptiveAllocator);
  return telemetry?.mode === "shadow" ? telemetry : null;
}

function routingTelemetry(job: NaturalYieldJobRow): RecordValue | null {
  const root = recordValue(job.inputReference);
  const result = recordValue(root?.result);
  return recordValue(result?.crossProductRoutingShadow);
}

export function summarizeAllocatorShadow(jobs: NaturalYieldJobRow[]): AllocatorShadowSummary {
  const summaries = jobs.map(allocatorTelemetry).filter((value): value is RecordValue => Boolean(value));
  const favored = new Map<string, number>(); const reduced = new Map<string, number>();
  let appliedEqualsBaseline = true;
  let proposalChanges = 0;
  let totalQueriesShifted = 0;
  let explorationAllocations = 0;
  let diversityFloorAllocations = 0;
  let sampleConfidenceTotal = 0;
  let sampleConfidenceCount = 0;
  let queryCap = 0; let candidateCap = 0; let evaluationCap = 0;
  const sourceHealthExclusions = new Set<string>();
  for (const telemetry of summaries) {
    const baseline = recordValue(telemetry.baselineAllocation);
    const proposed = recordValue(telemetry.proposedAllocation);
    const applied = recordValue(telemetry.appliedAllocation);
    appliedEqualsBaseline = appliedEqualsBaseline && allocationEquals(baseline, applied);
    if (!allocationEquals(baseline, proposed)) proposalChanges += 1;
    totalQueriesShifted += Math.floor(numberValue(telemetry.queriesShifted));
    explorationAllocations += Math.floor(numberValue(telemetry.explorationAllocations));
    diversityFloorAllocations += Math.floor(numberValue(telemetry.diversityFloorAllocations));
    const confidence = nullableNumber(telemetry.sampleConfidence);
    if (confidence !== null) { sampleConfidenceTotal += confidence; sampleConfidenceCount += 1; }
    for (const value of Array.isArray(telemetry.sourceHealthExclusions) ? telemetry.sourceHealthExclusions : []) if (typeof value === "string") sourceHealthExclusions.add(value);
    const cap = recordValue(telemetry.capPressure);
    queryCap += Math.floor(numberValue(cap?.queryCapSkips)); candidateCap += Math.floor(numberValue(cap?.candidateCapSkips)); evaluationCap += Math.floor(numberValue(cap?.evaluationCapSkips));
    const before = recordValue(proposed?.byQuery); const after = recordValue(baseline?.byQuery);
    if (before && after) for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta = numberValue(before[key]) - numberValue(after[key]);
      if (delta > 0) favored.set(key, (favored.get(key) ?? 0) + delta);
      if (delta < 0) reduced.set(key, (reduced.get(key) ?? 0) + Math.abs(delta));
    }
  }
  const top = (values: Map<string, number>) => [...values.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 10).map(([key]) => key);
  return {
    scansObserved: summaries.length, proposalChanges, totalQueriesShifted, explorationAllocations, diversityFloorAllocations,
    sourceHealthExclusions: [...sourceHealthExclusions].sort(), sampleConfidence: sampleConfidenceCount ? sampleConfidenceTotal / sampleConfidenceCount : null,
    appliedEqualsBaseline, favoredSurfaces: top(favored), reducedSurfaces: top(reduced), capPressure: { query: queryCap, candidate: candidateCap, evaluation: evaluationCap },
  };
}

export function summarizeRoutingShadow(jobs: NaturalYieldJobRow[]): RoutingShadowSummary {
  const summaries = jobs.map(routingTelemetry).filter((value): value is RecordValue => Boolean(value));
  const sum = (key: string) => summaries.reduce((total, value) => total + Math.floor(numberValue(value[key])), 0);
  return {
    scansObserved: summaries.length, conversationsExamined: sum("conversationsExamined"), routesCreated: sum("routesCreated"), routesReused: sum("routesReused"),
    noRouteDecisions: sum("noRouteDecisions"), capSkips: sum("capSkips"), semanticCalls: sum("semanticCalls"),
  };
}

export function buildNaturalYieldReport(input: NaturalYieldInput): NaturalYieldReport {
  const dates = windowDates(input.since, input.until);
  const daily = dates.map(emptyDay);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const queryRows = input.queries.filter((row) => inWindow(row.createdAt, input.since, input.until));
  const jobs = input.jobs.filter((job) => inWindow(job.createdAt, input.since, input.until) || (job.completedAt !== null && inWindow(job.completedAt, input.since, input.until)));
  const evaluations = input.evaluations.filter((row) => inWindow(row.createdAt, input.since, input.until));
  const signals = input.signals.filter((row) => inWindow(row.createdAt, input.since, input.until));
  const rawNewByDate = new Map<string, { total: number; missing: boolean }>();
  const scanDays = new Map<string, Set<string>>();
  for (const job of jobs) {
    const completionInWindow = job.completedAt !== null && inWindow(job.completedAt, input.since, input.until);
    const day = dateKey(completionInWindow ? job.completedAt! : job.createdAt);
    if (day && byDate.has(day)) { const ids = scanDays.get(day) ?? new Set<string>(); ids.add(job.id); scanDays.set(day, ids); }
  }
  for (const [day, ids] of scanDays) byDate.get(day)!.scans = ids.size;
  for (const row of queryRows) {
    const day = dateKey(row.createdAt); if (!day || !byDate.has(day)) continue; const target = byDate.get(day)!;
    target.plannedQueries += 1;
    if (!["execution_suppressed", "not_planned", "disabled", "unavailable"].includes(row.executionStatus)) target.executedQueries += 1;
    addUnique(target.sourcesAttempted, row.sourceKey); addUnique(target.partitionsObserved, row.marketPartitionKey);
    target.rawItems += row.rawItems; target.normalizedItems += row.normalizedItems; target.queryScopedUniqueConversations += row.uniqueConversations;
    target.duplicateItems += row.duplicateCount; target.selectedCandidates += row.selectedCount; target.qualifiedEvaluations += row.qualifiedInfluencedCount;
    target.weakCandidates += row.weakInfluencedCount; target.rejectedCandidates += row.rejectedInfluencedCount;
    target.evaluationCapPressure += row.evaluationCapSuppressedCount; target.providerFailures += ["provider_error", "unavailable", "degraded"].includes(row.executionStatus) ? 1 : 0;
    target.rateLimitSkips += row.executionStatus === "rate_limited" ? 1 : 0;
    const rawNew = rawNewByDate.get(day) ?? { total: 0, missing: false };
    if (row.rawNewItems === null) rawNew.missing = true; else rawNew.total += row.rawNewItems;
    rawNewByDate.set(day, rawNew);
  }
  for (const day of daily) { const rawNew = rawNewByDate.get(day.date); day.rawNewItems = rawNew && !rawNew.missing ? rawNew.total : null; }
  const qualifiedConversationIdsByDay = new Map<string, Set<string>>();
  for (const row of evaluations) {
    const day = dateKey(row.createdAt); if (!day || !byDate.has(day)) continue; const target = byDate.get(day)!; target.evaluations += 1;
    if (row.decision === "qualified") { const ids = qualifiedConversationIdsByDay.get(day) ?? new Set<string>(); ids.add(row.conversationId); qualifiedConversationIdsByDay.set(day, ids); }
  }
  for (const [day, ids] of qualifiedConversationIdsByDay) { byDate.get(day)!.qualifiedEvidence = ids.size; }
  for (const row of signals) { const day = dateKey(row.createdAt); if (day && byDate.has(day)) byDate.get(day)!.newSignals += 1; }
  for (const day of daily) { day.sourcesAttempted.sort(); day.partitionsObserved.sort(); }
  const rolling = { "3d": sumDays(daily.slice(-3), "3d"), "7d": sumDays(daily.slice(-7), "7d"), "14d": sumDays(daily.slice(-14), "14d") } as const;
  const surfaceMap = new Map<string, NaturalYieldSurface>();
  for (const row of queryRows) {
    const key = [row.sourceKey, row.queryPlanId, row.queryFamily, row.demandSurface, row.marketPartitionKey ?? ""].join("\u0000");
    const existing = surfaceMap.get(key) ?? { sourceKey: row.sourceKey, queryPlanId: row.queryPlanId, queryFamily: row.queryFamily, demandSurface: row.demandSurface, marketPartitionKey: row.marketPartitionKey, executions: 0, rawItems: 0, normalizedItems: 0, queryScopedUniqueConversations: 0, selectedCandidates: 0, evaluations: 0, qualifiedEvidenceInfluenced: 0, duplicateRate: null, rejectionRate: null, sampleSize: 0, firstObservedAt: row.createdAt, lastObservedAt: row.createdAt };
    existing.executions += 1; existing.rawItems += row.rawItems; existing.normalizedItems += row.normalizedItems; existing.queryScopedUniqueConversations += row.uniqueConversations; existing.selectedCandidates += row.selectedCount; existing.evaluations += row.evaluatedCount; existing.qualifiedEvidenceInfluenced += row.qualifiedInfluencedCount; existing.sampleSize += 1; existing.firstObservedAt = existing.firstObservedAt < row.createdAt ? existing.firstObservedAt : row.createdAt; existing.lastObservedAt = existing.lastObservedAt > row.createdAt ? existing.lastObservedAt : row.createdAt;
    existing.duplicateRate = existing.rawItems > 0 ? Math.min(1, Math.max(0, (existing.rawItems - existing.normalizedItems) / existing.rawItems)) : null;
    existing.rejectionRate = existing.evaluations > 0 ? Math.min(1, Math.max(0, row.rejectedInfluencedCount / existing.evaluations)) : null;
    surfaceMap.set(key, existing);
  }
  const lossFunnel = {
    noSourceCoverage: queryRows.length ? 0 : 1,
    noProviderResults: queryRows.filter((row) => !["execution_suppressed", "not_planned", "disabled", "unavailable"].includes(row.executionStatus) && row.rawItems === 0).length,
    highDuplication: queryRows.filter((row) => row.rawItems > 0 && row.duplicateCount >= row.rawItems / 2).length,
    lowCandidateSelection: queryRows.filter((row) => row.normalizedItems > 0 && row.selectedCount === 0).length,
    evaluationReject: evaluations.filter((row) => row.decision === "rejected").length,
    qualificationWeak: evaluations.filter((row) => row.decision === "weak_candidate").length,
    qualificationReject: evaluations.filter((row) => row.decision === "rejected").length,
    capPressure: queryRows.reduce((sum, row) => sum + row.sourceBudgetSuppressedCount + row.candidateBudgetSuppressedCount + row.evaluationCapSuppressedCount, 0),
    sourceHealth: queryRows.filter((row) => ["provider_error", "rate_limited", "unavailable", "degraded"].includes(row.executionStatus)).length,
    unknownObservabilityGap: 0,
  };
  const limitations = ["daily qualifiedEvidence is distinct qualified evaluations within each day; exact first-qualified window total comes from signal_supply_funnel", "distinct demand episodes are not inferred from conversations", "strengthened existing signals are not measurable without an append-only strengthening event", "scan provider request economics remain partial when adapters do not persist request counters"];
  return {
    version: "natural_yield_validation_v1", window: { since: input.since, until: input.until, timeZone: "UTC" }, scope: { workspaceId: input.workspaceId, productId: input.productId },
    measurability: naturalYieldMeasurability, daily, rolling, bySurface: [...surfaceMap.values()].sort((a, b) => `${a.sourceKey}:${a.queryPlanId}`.localeCompare(`${b.sourceKey}:${b.queryPlanId}`)),
    allocatorShadow: summarizeAllocatorShadow(jobs), routingShadow: summarizeRoutingShadow(jobs), sourceHealth: input.sourceHealth,
    qualifiedEvidence: { total: input.qualifiedEvidenceTotal ?? null, definition: "first_qualified_distinct_workspace_product_conversation_non_fixture", dailyBasis: "window_distinct_evaluations" },
    lossFunnel, qualityReviewDimensions: QUALITY_REVIEW_DIMENSIONS, limitations,
  };
}
