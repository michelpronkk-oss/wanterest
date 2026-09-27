import { z } from "zod";

import { ADAPTIVE_ALLOCATOR_VERSION, type AdaptiveAllocatorMode } from "./adaptive-allocator.config";

export { ADAPTIVE_ALLOCATOR_VERSION };

export const adaptiveAllocatorReasonCodeSchema = z.enum([
  "HIGH_QUALIFIED_YIELD",
  "LOW_SAMPLE_EXPLORATION",
  "NEUTRAL_COLD_START",
  "SOURCE_DIVERSITY_FLOOR",
  "SOURCE_HEALTH_SUPPRESSION",
  "RECENT_YIELD_IMPROVEMENT",
  "LOW_EVALUATION_EFFICIENCY",
  "HIGH_DUPLICATE_RATE",
  "PARTITION_EXPLORATION",
  "CAP_CONSTRAINT",
  "COMPETITOR_MIX_CONSTRAINT",
  "BASELINE_UNCHANGED",
]);
export type AdaptiveAllocatorReasonCode = z.infer<typeof adaptiveAllocatorReasonCodeSchema>;

export type AdaptiveAllocatorHistoryRow = {
  queryPlanId: string;
  sourceKey: string;
  queryFamily: string;
  demandSurface: string;
  marketPartitionKey: string | null;
  createdAt: string;
  executionStatus: string;
  pagesRequested: number;
  normalizedItems: number;
  uniqueConversations: number;
  duplicateCount: number;
  selectedCount: number;
  evaluatedCount: number;
  qualifiedInfluencedCount: number;
  estimatedCostUsd: number | null;
};

export type AdaptiveAllocatorSourceState = {
  sourceKey: string;
  configured: boolean;
  controlState: string;
  healthStatus: string;
};

export type AdaptiveAllocatorSurface = {
  queryPlanId: string;
  sourceKey: string;
  queryFamily: string;
  demandSurface: string;
  competitorSpecific: boolean;
  candidateBudget: number;
  score: number;
  sampleSize: number;
  confidence: number;
  historicalRows: number;
  qualifiedEvidence: number;
  qualifiedEvidencePerRetrievalUnit: number;
  candidateYield: number | null;
  evaluationEfficiency: number | null;
  duplicateRate: number;
  reasonCodes: AdaptiveAllocatorReasonCode[];
};

export type AdaptiveAllocatorAllocationSnapshot = {
  totalQueryCount: number;
  totalCandidateSlots: number;
  byQuery: Record<string, number>;
  bySource: Record<string, number>;
  byPartition: Record<string, number>;
};

export type AdaptiveAllocatorTelemetry = {
  version: typeof ADAPTIVE_ALLOCATOR_VERSION;
  mode: AdaptiveAllocatorMode;
  historyWindowDays: number;
  historyRowsRead: number;
  eligibleSurfaceCount: number;
  historicalSurfaceCount: number;
  coldStartSurfaceCount: number;
  eligibleSurfaces: string[];
  historicalSurfaces: string[];
  coldStartSurfaces: string[];
  baselineAllocation: AdaptiveAllocatorAllocationSnapshot;
  proposedAllocation: AdaptiveAllocatorAllocationSnapshot;
  appliedAllocation: AdaptiveAllocatorAllocationSnapshot;
  surfaceScores: AdaptiveAllocatorSurface[];
  queriesShifted: number;
  sourceAllocationBefore: Record<string, number>;
  sourceAllocationAfter: Record<string, number>;
  partitionAllocationBefore: Record<string, number>;
  partitionAllocationAfter: Record<string, number>;
  qualifiedEvidenceHistoricalYield: number;
  candidateHistoricalYield: number | null;
  evaluationEfficiency: number | null;
  sampleConfidence: number;
  explorationAllocations: number;
  diversityFloorAllocations: number;
  sourceHealthExclusions: string[];
  capPressure: {
    queryCap: number;
    candidateCap: number;
    evaluationCap: number;
    queryCapSkips: number;
    candidateCapSkips: number;
    evaluationCapSkips: number;
    competitorMixConstrained: boolean;
  };
  computationDurationMs: number;
  warnings: string[];
  errors: string[];
};

export const adaptiveAllocatorTelemetrySchema: z.ZodType<AdaptiveAllocatorTelemetry> = z.object({
  version: z.literal(ADAPTIVE_ALLOCATOR_VERSION),
  mode: z.enum(["off", "shadow", "active"]),
  historyWindowDays: z.number().int().nonnegative(),
  historyRowsRead: z.number().int().nonnegative(),
  eligibleSurfaceCount: z.number().int().nonnegative(),
  historicalSurfaceCount: z.number().int().nonnegative(),
  coldStartSurfaceCount: z.number().int().nonnegative(),
  eligibleSurfaces: z.array(z.string()),
  historicalSurfaces: z.array(z.string()),
  coldStartSurfaces: z.array(z.string()),
  baselineAllocation: z.object({ totalQueryCount: z.number().int().nonnegative(), totalCandidateSlots: z.number().int().nonnegative(), byQuery: z.record(z.string(), z.number().int().nonnegative()), bySource: z.record(z.string(), z.number().int().nonnegative()), byPartition: z.record(z.string(), z.number().int().nonnegative()) }),
  proposedAllocation: z.object({ totalQueryCount: z.number().int().nonnegative(), totalCandidateSlots: z.number().int().nonnegative(), byQuery: z.record(z.string(), z.number().int().nonnegative()), bySource: z.record(z.string(), z.number().int().nonnegative()), byPartition: z.record(z.string(), z.number().int().nonnegative()) }),
  appliedAllocation: z.object({ totalQueryCount: z.number().int().nonnegative(), totalCandidateSlots: z.number().int().nonnegative(), byQuery: z.record(z.string(), z.number().int().nonnegative()), bySource: z.record(z.string(), z.number().int().nonnegative()), byPartition: z.record(z.string(), z.number().int().nonnegative()) }),
  surfaceScores: z.array(z.object({ queryPlanId: z.string(), sourceKey: z.string(), queryFamily: z.string(), demandSurface: z.string(), competitorSpecific: z.boolean(), candidateBudget: z.number().int().nonnegative(), score: z.number().min(0).max(1), sampleSize: z.number().nonnegative(), confidence: z.number().min(0).max(1), historicalRows: z.number().int().nonnegative(), qualifiedEvidence: z.number().nonnegative(), qualifiedEvidencePerRetrievalUnit: z.number().nonnegative(), candidateYield: z.number().min(0).max(1).nullable(), evaluationEfficiency: z.number().min(0).max(1).nullable(), duplicateRate: z.number().min(0).max(1), reasonCodes: z.array(adaptiveAllocatorReasonCodeSchema) })),
  queriesShifted: z.number().int().nonnegative(),
  sourceAllocationBefore: z.record(z.string(), z.number().int().nonnegative()),
  sourceAllocationAfter: z.record(z.string(), z.number().int().nonnegative()),
  partitionAllocationBefore: z.record(z.string(), z.number().int().nonnegative()),
  partitionAllocationAfter: z.record(z.string(), z.number().int().nonnegative()),
  qualifiedEvidenceHistoricalYield: z.number().nonnegative(),
  candidateHistoricalYield: z.number().min(0).max(1).nullable(),
  evaluationEfficiency: z.number().min(0).max(1).nullable(),
  sampleConfidence: z.number().min(0).max(1),
  explorationAllocations: z.number().int().nonnegative(),
  diversityFloorAllocations: z.number().int().nonnegative(),
  sourceHealthExclusions: z.array(z.string()),
  capPressure: z.object({ queryCap: z.number().int().nonnegative(), candidateCap: z.number().int().nonnegative(), evaluationCap: z.number().int().nonnegative(), queryCapSkips: z.number().int().nonnegative(), candidateCapSkips: z.number().int().nonnegative(), evaluationCapSkips: z.number().int().nonnegative(), competitorMixConstrained: z.boolean() }),
  computationDurationMs: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});
