import { z } from "zod";

import {
  classifySourceHealth,
  type SourceHealthClassifierInput,
  type SourceHealthErrorInput,
  type SourceHealthExecutionStatus,
  type SourceHealthResultV1,
  type SourceHealthState,
} from "./source-health";
import type { SourceRoutingPriority } from "./source-routing.schemas";

export const SOURCE_HEALTH_VERSION = "source_health_v1" as const;

const sourceHealthStateSchema = z.enum([
  "healthy_with_results",
  "healthy_zero_results",
  "auth_error",
  "rate_limited",
  "quota_exhausted",
  "temporary_provider_error",
  "permanent_provider_error",
  "misconfigured",
  "budget_limited",
  "disabled",
  "unknown_failure",
]);

const sourceHealthConfigStateSchema = z.enum(["configured", "missing", "disabled", "unknown"]);

export const sourceHealthV1SourceSchema = z.object({
  state: sourceHealthStateSchema,
  available: z.boolean(),
  retryable: z.boolean(),
  plannedQueries: z.number().int().nonnegative(),
  executedQueries: z.number().int().nonnegative(),
  successfulQueries: z.number().int().nonnegative(),
  failedQueries: z.number().int().nonnegative(),
  zeroResultQueries: z.number().int().nonnegative(),
  normalizedItems: z.number().int().nonnegative(),
  providerStatus: z.number().int().nullable(),
  providerCode: z.string().nullable(),
  retryAfterSeconds: z.number().int().nonnegative().nullable(),
  configState: sourceHealthConfigStateSchema,
  lastSuccessfulAt: z.string().nullable(),
  degradedReason: z.string().max(500).nullable(),
  partial: z.boolean(),
  coverageFraction: z.number().min(0).max(1),
  coverageWeight: z.number().nonnegative(),
});

export const sourceHealthV1Schema = z.object({
  version: z.literal(SOURCE_HEALTH_VERSION),
  sources: z.record(z.string(), sourceHealthV1SourceSchema),
  coverage: z.object({
    score: z.number().min(0).max(1),
    label: z.enum(["full_coverage", "limited_coverage", "severely_degraded"]),
    plannedSourceCount: z.number().int().nonnegative(),
    healthySourceCount: z.number().int().nonnegative(),
    degradedSourceCount: z.number().int().nonnegative(),
    unavailableSourceCount: z.number().int().nonnegative(),
  }),
});

export type SourceHealthConfigState = z.infer<typeof sourceHealthConfigStateSchema>;
export type SourceHealthV1Source = z.infer<typeof sourceHealthV1SourceSchema>;
export type SourceHealthV1 = z.infer<typeof sourceHealthV1Schema>;

export type SourceHealthPlannedQuery = {
  queryPlanId: string;
  sourceKey: string;
  priority?: SourceRoutingPriority;
};

export type SourceHealthQueryArtifact = {
  queryPlanId: string;
  sourceKey: string;
  executionStatus: SourceHealthExecutionStatus;
  normalizedItems: number;
  providerStatus?: number | null;
  providerCode?: string | null;
  retryAfterSeconds?: number | null;
  configState?: SourceHealthConfigState;
  lastSuccessfulAt?: string | null;
  degradedReason?: string | null;
  usableOutput?: boolean;
  error?: SourceHealthErrorInput | null;
  controlState?: SourceHealthClassifierInput["controlState"];
  configurationState?: SourceHealthClassifierInput["configurationState"];
  rateLimitState?: SourceHealthClassifierInput["rateLimitState"];
};

export type SourceHealthPlannedSource = {
  sourceKey: string;
  priority?: SourceRoutingPriority;
  plannedQueries?: number;
  executionStatus?: SourceHealthExecutionStatus;
  normalizedItems?: number;
  providerStatus?: number | null;
  providerCode?: string | null;
  retryAfterSeconds?: number | null;
  configState?: SourceHealthConfigState;
  controlState?: SourceHealthClassifierInput["controlState"];
  configurationState?: SourceHealthClassifierInput["configurationState"];
  lastSuccessfulAt?: string | null;
  degradedReason?: string | null;
  error?: SourceHealthErrorInput | null;
  rateLimitState?: SourceHealthClassifierInput["rateLimitState"];
};

export type SourceHealthAggregationInput = {
  plannedSources: SourceHealthPlannedSource[];
  plannedQueries: SourceHealthPlannedQuery[];
  executions: SourceHealthQueryArtifact[];
};

const priorityRank: Record<SourceRoutingPriority, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

const coverageWeightByPriority: Record<SourceRoutingPriority, number> = {
  off: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.8,
  very_high: 1,
};

const failurePrecedence: SourceHealthState[] = [
  "auth_error",
  "quota_exhausted",
  "rate_limited",
  "misconfigured",
  "permanent_provider_error",
  "temporary_provider_error",
  "unknown_failure",
];

const healthyStates = new Set<SourceHealthState>(["healthy_with_results", "healthy_zero_results"]);
const nonExecutedStates = new Set<SourceHealthState>(["budget_limited", "disabled", "misconfigured"]);

function normalizedCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function boundedFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function coverageWeight(priority: SourceRoutingPriority | undefined): number {
  return coverageWeightByPriority[priority ?? "medium"];
}

function isHealthyState(state: SourceHealthState): boolean {
  return healthyStates.has(state);
}

function isFailureExecutionStatus(status: SourceHealthExecutionStatus): boolean {
  return status !== "completed" && status !== "completed_with_results" && status !== "completed_zero_results";
}

function failureState(states: SourceHealthState[]): SourceHealthState | undefined {
  for (const state of failurePrecedence) {
    if (states.includes(state)) return state;
  }
  if (states.includes("budget_limited")) return "budget_limited";
  if (states.includes("disabled")) return "disabled";
  return undefined;
}

function uniquePlannedSources(input: SourceHealthAggregationInput): SourceHealthPlannedSource[] {
  const sources = new Map<string, SourceHealthPlannedSource>();
  for (const source of input.plannedSources) {
    if (!sources.has(source.sourceKey)) sources.set(source.sourceKey, source);
  }
  for (const query of input.plannedQueries) {
    if (!sources.has(query.sourceKey)) sources.set(query.sourceKey, { sourceKey: query.sourceKey, priority: query.priority });
  }
  return [...sources.values()].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

function plannedQueryIds(source: SourceHealthPlannedSource, plannedQueries: SourceHealthPlannedQuery[]): string[] {
  const ids = plannedQueries
    .filter((query) => query.sourceKey === source.sourceKey)
    .map((query) => query.queryPlanId)
    .filter((queryPlanId, index, values) => values.indexOf(queryPlanId) === index)
    .sort((left, right) => left.localeCompare(right));
  const targetCount = Math.max(ids.length, normalizedCount(source.plannedQueries));
  return [...ids, ...Array.from({ length: Math.max(0, targetCount - ids.length) }, (_, index) => `${source.sourceKey}:planned:${index + 1}`)];
}

function executionForQuery(executions: SourceHealthQueryArtifact[], queryPlanId: string): SourceHealthQueryArtifact | undefined {
  return executions
    .filter((execution) => execution.queryPlanId === queryPlanId)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))[0];
}

function classifyExecution(source: SourceHealthPlannedSource, execution: SourceHealthQueryArtifact | undefined): SourceHealthResultV1 {
  const fallbackStatus = source.executionStatus ?? "execution_suppressed";
  const status = execution?.executionStatus ?? fallbackStatus;
  const hasFailureStatus = isFailureExecutionStatus(status);
  return classifySourceHealth({
    executionStatus: status,
    normalizedItems: execution?.normalizedItems ?? source.normalizedItems ?? 0,
    error: execution?.error ?? source.error,
    providerCode: execution?.providerCode ?? (hasFailureStatus ? source.providerCode : undefined),
    providerStatus: execution?.providerStatus ?? (hasFailureStatus ? source.providerStatus : undefined),
    configurationState: execution?.configurationState ?? source.configurationState,
    controlState: execution?.controlState ?? source.controlState,
    rateLimitState: execution?.rateLimitState ?? source.rateLimitState,
    usableOutput: execution?.usableOutput,
  });
}

function configState(source: SourceHealthPlannedSource, state: SourceHealthState, available: boolean): SourceHealthConfigState {
  if (source.configState) return source.configState;
  if (state === "disabled" || source.controlState === "disabled") return "disabled";
  if (state === "misconfigured" || source.configurationState === "missing" || source.controlState === "misconfigured") return "missing";
  if (available || source.configurationState === "configured" || source.controlState === "enabled") return "configured";
  return "unknown";
}

function aggregateSource(source: SourceHealthPlannedSource, plannedQueries: SourceHealthPlannedQuery[], executions: SourceHealthQueryArtifact[]): SourceHealthV1Source {
  const ids = plannedQueryIds(source, plannedQueries);
  const queryResults = ids.map((queryPlanId) => {
    const execution = executionForQuery(executions, queryPlanId);
    return { execution, classification: classifyExecution(source, execution) };
  });
  const classifications = queryResults.map((query) => query.classification);
  const states = classifications.map((classification) => classification.state);
  const plannedCount = ids.length;
  const successfulQueries = classifications.filter((classification) => isHealthyState(classification.state)).length;
  const zeroResultQueries = classifications.filter((classification) => classification.state === "healthy_zero_results").length;
  const failedQueries = Math.max(0, plannedCount - successfulQueries);
  const executedQueries = queryResults.filter(({ execution, classification }) => execution !== undefined && !nonExecutedStates.has(classification.state)).length;
  const normalizedItems = queryResults.some((query) => query.execution !== undefined)
    ? queryResults.reduce((sum, query) => sum + (query.execution ? normalizedCount(query.execution.normalizedItems) : 0), 0)
    : normalizedCount(source.normalizedItems);
  const firstFailure = failureState(states);
  const fallbackClassification = plannedCount === 0 ? classifyExecution(source, undefined) : null;
  const state = plannedCount === 0
    ? fallbackClassification?.state ?? "unknown_failure"
    : failedQueries === 0
      ? normalizedItems > 0 ? "healthy_with_results" : "healthy_zero_results"
      : firstFailure ?? "unknown_failure";
  const available = plannedCount === 0
    ? fallbackClassification?.available ?? false
    : successfulQueries > 0;
  const partial = successfulQueries > 0 && failedQueries > 0;
  const retryable = plannedCount === 0
    ? fallbackClassification?.retryable ?? false
    : (partial || !available) && classifications.some((classification) => !isHealthyState(classification.state) && classification.retryable);
  const coverageFraction = isHealthyState(state)
    ? 1
    : partial && plannedCount > 0
      ? boundedFraction(successfulQueries / plannedCount)
      : 0;
  const firstExecution = queryResults.find((query) => query.execution)?.execution;
  const providerStatus = source.providerStatus ?? firstExecution?.providerStatus ?? null;
  const providerCode = source.providerCode ?? firstExecution?.providerCode ?? null;
  const retryAfterSeconds = source.retryAfterSeconds ?? firstExecution?.retryAfterSeconds ?? null;
  const degradedReason = source.degradedReason ?? (isHealthyState(state) ? null : state);

  return {
    state,
    available,
    retryable: isHealthyState(state) ? false : retryable,
    plannedQueries: plannedCount,
    executedQueries,
    successfulQueries,
    failedQueries,
    zeroResultQueries,
    normalizedItems,
    providerStatus,
    providerCode,
    retryAfterSeconds,
    configState: configState(source, state, available),
    lastSuccessfulAt: source.lastSuccessfulAt ?? null,
    degradedReason,
    partial,
    coverageFraction,
    coverageWeight: coverageWeight(source.priority),
  };
}

function coverageLabel(entries: ReadonlyArray<readonly [string, SourceHealthV1Source]>, coverageScore: number, priorities: Array<{ sourceKey: string; priority?: SourceRoutingPriority }>): "full_coverage" | "limited_coverage" | "severely_degraded" {
  const priorityBySource = new Map(priorities.map((source) => [source.sourceKey, source.priority ?? "medium"]));
  const highestPriority = Math.max(...entries.map(([sourceKey]) => priorityRank[priorityBySource.get(sourceKey) ?? "medium"]), 0);
  const highestPriorityFailed = entries.some(([sourceKey, source]) => source.coverageFraction === 0 && priorityRank[priorityBySource.get(sourceKey) ?? "medium"] === highestPriority && highestPriority > 0);
  if (coverageScore < 0.5 || highestPriorityFailed) return "severely_degraded";
  if (coverageScore >= 1 && entries.every(([, source]) => isHealthyState(source.state))) return "full_coverage";
  return "limited_coverage";
}

/** Aggregates canonical query health into one bounded scan diagnostic. */
export function aggregateSourceHealthV1(input: SourceHealthAggregationInput): SourceHealthV1 {
  const plannedSources = uniquePlannedSources(input);
  const sourceEntries = plannedSources.map((source) => [source.sourceKey, aggregateSource(source, input.plannedQueries, input.executions)] as const);
  const sources = Object.fromEntries(sourceEntries);
  const sourceValues = sourceEntries.map(([, source]) => source);
  const weightedTotal = sourceValues.reduce((sum, source) => sum + source.coverageWeight, 0);
  const weightedScore = weightedTotal > 0
    ? sourceValues.reduce((sum, source) => sum + source.coverageWeight * source.coverageFraction, 0) / weightedTotal
    : 0;
  const score = boundedFraction(weightedScore);
  const label = coverageLabel(sourceEntries, score, plannedSources);

  return {
    version: SOURCE_HEALTH_VERSION,
    sources,
    coverage: {
      score,
      label,
      plannedSourceCount: sourceValues.length,
      healthySourceCount: sourceValues.filter((source) => isHealthyState(source.state)).length,
      degradedSourceCount: sourceValues.filter((source) => !isHealthyState(source.state) && source.available).length,
      unavailableSourceCount: sourceValues.filter((source) => !source.available).length,
    },
  };
}
