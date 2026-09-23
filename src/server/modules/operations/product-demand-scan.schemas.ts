import { z } from "zod";

export const scanModeSchema = z.enum(["onboarding", "baseline", "manual", "manual_refresh", "manual_deep", "scheduled", "monitoring", "intelligence_cycle", "deep", "deep_refresh"]);
export type ScanMode = z.infer<typeof scanModeSchema>;

export const productDemandScanInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
  scanMode: scanModeSchema,
  idempotencyKey: z.string().trim().min(1).max(240),
  forceRebuild: z.boolean().optional().default(false),
  jobRunId: z.string().uuid().optional(),
  monitoringScheduleId: z.string().uuid().optional(),
  monitoringLeaseToken: z.string().trim().min(1).max(200).optional(),
});
export type ProductDemandScanInput = z.infer<typeof productDemandScanInputSchema>;
/** Internal child-task contract; nullable IDs preserve evaluation ordering when a candidate is filtered. */
export const demandTaskInputSchema = z.object({
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  evaluationIds: z.array(z.string().uuid()).max(500),
  signalIds: z.array(z.string().uuid().nullable()).max(500),
  traceId: z.string().trim().min(1).max(120),
});
export type DemandTaskInput = z.infer<typeof demandTaskInputSchema>;

export const productDemandScanRequestSchema = productDemandScanInputSchema.omit({ requestedByUserId: true, jobRunId: true, monitoringScheduleId: true, monitoringLeaseToken: true }).extend({
  idempotencyKey: z.string().trim().min(1).max(240).optional(),
});
export type ProductDemandScanRequest = z.infer<typeof productDemandScanRequestSchema>;

export const scanProgressSchema = z.object({
  stage: z.enum([
    "queued",
    "preparing_product",
    "planning",
    "discovering",
    "processing",
    "qualifying",
    "building_intelligence",
    "generating_actions",
    "completed",
    "partial_failure",
    "failed",
  ]),
  percent: z.number().int().min(0).max(100),
  completedSources: z.number().int().nonnegative(),
  totalSources: z.number().int().nonnegative(),
  currentLabel: z.string().max(200),
  warnings: z.array(z.string().max(500)).max(100),
});
export type ScanProgress = z.infer<typeof scanProgressSchema>;

export const scanStatusSchema = z.enum(["queued", "running", "succeeded", "completed_with_warnings", "failed", "cancelled"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const sourceResolutionSchema = z.object({
  status: z.enum(["resolved", "no_match", "ambiguous_match"]),
  targetKey: z.string().trim().min(1).max(180),
  targetFingerprint: z.string().trim().min(1).max(500),
  productId: z.string().trim().max(200).optional(),
  matchedBy: z.enum(["domain", "name", "slug", "vendor_product_metadata"]).optional(),
  candidateProductIds: z.array(z.string().trim().min(1).max(200)).max(25),
  resolvedAt: z.string().datetime({ offset: true }),
  resolverVersion: z.string().trim().min(1).max(120),
});
export type SourceResolution = z.infer<typeof sourceResolutionSchema>;

export const sourceScanResultSchema = z.object({
  sourceKey: z.string(),
  planned: z.boolean(),
  executed: z.boolean(),
  status: z.enum(["completed", "skipped", "failed"]),
  queryCount: z.number().int().nonnegative(),
  candidateBudget: z.number().int().nonnegative(),
  itemsReturned: z.number().int().nonnegative(),
  rawItems: z.number().int().nonnegative(),
  normalizedItems: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(500)),
  errorCode: z.string().nullable(),
  rateLimitRemaining: z.number().int().nonnegative().nullable(),
  estimatedCost: z.number().nonnegative().nullable(),
  providerMetrics: z.record(z.string(), z.unknown()).optional(),
  resolutions: z.array(sourceResolutionSchema).max(25).optional(),
});
export type SourceScanResult = z.infer<typeof sourceScanResultSchema>;

/** Sanitized review data for candidates that were scanned but did not become Signals. */
export const scanCandidateReviewSchema = z.object({
  evaluationId: z.string().uuid(),
  source: z.string().trim().min(1).max(120),
  title: z.string().trim().max(300).nullable(),
  excerpt: z.string().trim().min(1).max(500),
  canonicalUrl: z.string().trim().max(2_000).nullable(),
  status: z.enum(["weak_candidate", "rejected"]),
  scores: z.object({
    relevance: z.number().min(0).max(1),
    intent: z.number().min(0).max(1),
    pain: z.number().min(0).max(1),
    specificity: z.number().min(0).max(1),
    evidence: z.number().min(0).max(1),
    noise: z.number().min(0).max(1),
  }),
  reasonCodes: z.array(z.string().trim().min(1).max(120)).max(20),
});
export type ScanCandidateReview = z.infer<typeof scanCandidateReviewSchema>;

/** Safe, provider-neutral result fields exposed to the dashboard after a scan. */
export const scanResultSummarySchema = z.object({
  rawItems: z.number().int().nonnegative().default(0),
  normalizedItems: z.number().int().nonnegative().default(0),
  conversations: z.number().int().nonnegative().default(0),
  analyses: z.number().int().nonnegative().default(0),
  evaluations: z.number().int().nonnegative().default(0),
  rankings: z.number().int().nonnegative().default(0),
  signals: z.number().int().nonnegative().default(0),
  sources: z.array(z.string()).default([]),
  mapUpdated: z.number().int().nonnegative().default(0),
  gapUpdated: z.number().int().nonnegative().default(0),
  driftUpdated: z.number().int().nonnegative().default(0),
  actionsUpdated: z.number().int().nonnegative().default(0),
  candidateReviews: z.array(scanCandidateReviewSchema).max(100).optional(),
  qualification: z.object({
    candidateCount: z.number().int().nonnegative(),
    qualifiedCount: z.number().int().nonnegative(),
    highConfidenceCount: z.number().int().nonnegative(),
    weakCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
  }).optional(),
});
export type ScanResultSummary = z.infer<typeof scanResultSummarySchema>;

export const productDemandScanHandleSchema = z.object({
  jobRunId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(240),
  status: z.enum(["started", "resumed", "recovered"]),
  scanMode: scanModeSchema,
  triggerRunId: z.string().nullable(),
});
export type ProductDemandScanHandle = z.infer<typeof productDemandScanHandleSchema>;

export const productDemandScanSummarySchema = z.object({
  jobRunId: z.string().uuid(),
  status: scanStatusSchema,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  sourcesPlanned: z.number().int().nonnegative(),
  sourcesCompleted: z.number().int().nonnegative(),
  sourcesFailed: z.number().int().nonnegative(),
  rawItems: z.number().int().nonnegative(),
  normalizedItems: z.number().int().nonnegative(),
  qualifiedSignals: z.number().int().nonnegative(),
  highConfidenceSignals: z.number().int().nonnegative(),
  mapUpdated: z.number().int().nonnegative(),
  gapUpdated: z.number().int().nonnegative(),
  driftUpdated: z.number().int().nonnegative(),
  actionsUpdated: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(500)),
});
export type ProductDemandScanSummary = z.infer<typeof productDemandScanSummarySchema>;

export function frontendScanStatus(progress: ScanProgress | null, status: string): ScanStatus {
  if (status === "succeeded") return progress?.stage === "partial_failure" ? "completed_with_warnings" : "succeeded";
  if (status === "failed" || status === "failed_terminal") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "pending") return "queued";
  return "running";
}
