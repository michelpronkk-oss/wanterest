import { z } from "zod";

export const NATURAL_YIELD_VALIDATION_VERSION = "natural_yield_validation_v1" as const;
export const NATURAL_YIELD_TIME_ZONE = "UTC" as const;
export const NATURAL_YIELD_MAX_DAYS = 14;
export const NATURAL_YIELD_MAX_ROWS = 20_000;

export const measurementStatusSchema = z.enum(["MEASURABLE_NOW", "PARTIALLY_MEASURABLE", "NOT_MEASURABLE"]);
export type MeasurementStatus = z.infer<typeof measurementStatusSchema>;

export type MeasurementCoverage = { status: MeasurementStatus; reason: string };

export const naturalYieldMeasurability: Readonly<Record<string, MeasurementCoverage>> = {
  scansPerProduct: { status: "MEASURABLE_NOW", reason: "bounded discover-source job_runs" },
  plannedQueries: { status: "MEASURABLE_NOW", reason: "one immutable query_yield_artifacts row per planned query" },
  executedQueries: { status: "MEASURABLE_NOW", reason: "query artifact execution_status" },
  sourceHealth: { status: "MEASURABLE_NOW", reason: "query status plus persisted Source Health read model" },
  rawAndNormalizedItems: { status: "MEASURABLE_NOW", reason: "query artifact counts" },
  canonicalConversations: { status: "PARTIALLY_MEASURABLE", reason: "query artifacts expose query-scoped unique counts, not a query-to-conversation join" },
  candidatesAndEvaluations: { status: "MEASURABLE_NOW", reason: "query artifact influence counts and immutable evaluation rows" },
  qualificationOutcomes: { status: "MEASURABLE_NOW", reason: "evaluation decisions and query influence counts" },
  qualifiedEvidence: { status: "MEASURABLE_NOW", reason: "signal_supply_funnel first-qualified distinct conversation contract" },
  demandEpisodes: { status: "PARTIALLY_MEASURABLE", reason: "canonical conversations are measurable, but no durable episode event is stored" },
  newSignals: { status: "MEASURABLE_NOW", reason: "signals created_at scoped to the report window" },
  strengthenedSignals: { status: "NOT_MEASURABLE", reason: "no append-only strengthening event distinguishes reuse from ordinary evaluation" },
  clusterStrengthening: { status: "PARTIALLY_MEASURABLE", reason: "creation facts exist; durable strengthening events are not persisted" },
  provenanceCompleteness: { status: "PARTIALLY_MEASURABLE", reason: "provenance rows are queryable, but completeness requires an explicit bounded audit" },
  sourceQueryPartitionYield: { status: "MEASURABLE_NOW", reason: "stable source, query_plan_id, and market_partition_key columns" },
  providerRequestEconomics: { status: "PARTIALLY_MEASURABLE", reason: "refresh facts have request counters; scan query artifacts expose pages but not every provider request" },
  allocatorShadow: { status: "MEASURABLE_NOW", reason: "bounded adaptiveAllocator telemetry in job_runs" },
  routingShadow: { status: "MEASURABLE_NOW", reason: "crossProductRoutingShadow telemetry in job_runs" },
  capPressure: { status: "MEASURABLE_NOW", reason: "query artifacts and allocator capPressure telemetry" },
};

export type NaturalYieldQueryRow = {
  jobRunId: string;
  createdAt: string;
  queryPlanId: string;
  sourceKey: string;
  queryFamily: string;
  demandSurface: string;
  marketPartitionKey: string | null;
  executionStatus: string;
  pagesRequested: number;
  pagesCompleted: number;
  rawItems: number;
  rawNewItems: number | null;
  normalizedItems: number;
  uniqueConversations: number;
  duplicateCount: number;
  sourceBudgetSuppressedCount: number;
  candidateBudgetSuppressedCount: number;
  evaluationCapSuppressedCount: number;
  selectedCount: number;
  evaluatedCount: number;
  qualifiedInfluencedCount: number;
  weakInfluencedCount: number;
  rejectedInfluencedCount: number;
  estimatedCostUsd: number | null;
};

export type NaturalYieldJobRow = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  inputReference: unknown;
};

export type NaturalYieldEvaluationRow = {
  id: string;
  conversationId: string;
  decision: string;
  createdAt: string;
};

export type NaturalYieldSignalRow = {
  id: string;
  conversationId: string;
  createdAt: string;
  lifecycleStatus: string;
};

export type NaturalYieldSourceHealthRow = {
  sourceKey: string;
  environment: string;
  degradationState: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  latestErrorCode: string | null;
};

export type NaturalYieldInput = {
  since: string;
  until: string;
  workspaceId: string;
  productId: string;
  queries: NaturalYieldQueryRow[];
  jobs: NaturalYieldJobRow[];
  evaluations: NaturalYieldEvaluationRow[];
  signals: NaturalYieldSignalRow[];
  sourceHealth: NaturalYieldSourceHealthRow[];
  qualifiedEvidenceTotal?: number | null;
};

export type DailyNaturalYield = {
  date: string;
  scans: number;
  plannedQueries: number;
  executedQueries: number;
  sourcesAttempted: string[];
  partitionsObserved: string[];
  rawItems: number;
  rawNewItems: number | null;
  normalizedItems: number;
  queryScopedUniqueConversations: number;
  duplicateItems: number;
  selectedCandidates: number;
  evaluations: number;
  qualifiedEvaluations: number;
  weakCandidates: number;
  rejectedCandidates: number;
  qualifiedEvidence: number;
  newSignals: number;
  strengthenedSignals: number | null;
  distinctDemandEpisodes: number | null;
  providerRequests: number | null;
  providerFailures: number;
  rateLimitSkips: number;
  evaluationCapPressure: number;
};

export type NaturalYieldSurface = {
  sourceKey: string;
  queryPlanId: string;
  queryFamily: string;
  demandSurface: string;
  marketPartitionKey: string | null;
  executions: number;
  rawItems: number;
  normalizedItems: number;
  queryScopedUniqueConversations: number;
  selectedCandidates: number;
  evaluations: number;
  qualifiedEvidenceInfluenced: number;
  duplicateRate: number | null;
  rejectionRate: number | null;
  sampleSize: number;
  firstObservedAt: string;
  lastObservedAt: string;
};

export type AllocatorShadowSummary = {
  scansObserved: number;
  proposalChanges: number;
  totalQueriesShifted: number;
  explorationAllocations: number;
  diversityFloorAllocations: number;
  sourceHealthExclusions: string[];
  sampleConfidence: number | null;
  appliedEqualsBaseline: boolean;
  favoredSurfaces: string[];
  reducedSurfaces: string[];
  capPressure: { query: number; candidate: number; evaluation: number };
};

export type RoutingShadowSummary = {
  scansObserved: number;
  conversationsExamined: number;
  routesCreated: number;
  routesReused: number;
  noRouteDecisions: number;
  capSkips: number;
  semanticCalls: number;
};

export type NaturalYieldReport = {
  version: typeof NATURAL_YIELD_VALIDATION_VERSION;
  window: { since: string; until: string; timeZone: typeof NATURAL_YIELD_TIME_ZONE };
  scope: { workspaceId: string; productId: string };
  measurability: Readonly<Record<string, MeasurementCoverage>>;
  daily: DailyNaturalYield[];
  rolling: Record<"3d" | "7d" | "14d", DailyNaturalYield>;
  bySurface: NaturalYieldSurface[];
  allocatorShadow: AllocatorShadowSummary;
  routingShadow: RoutingShadowSummary;
  sourceHealth: NaturalYieldSourceHealthRow[];
  qualifiedEvidence: { total: number | null; definition: string; dailyBasis: "window_distinct_evaluations" | "unavailable" };
  lossFunnel: Record<string, number>;
  qualityReviewDimensions: readonly string[];
  limitations: string[];
};
