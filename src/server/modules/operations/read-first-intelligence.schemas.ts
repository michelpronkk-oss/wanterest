import { z } from "zod";

export const readFirstFreshnessStateSchema = z.enum(["fresh", "recent", "stale", "empty"]);
export type ReadFirstFreshnessState = z.infer<typeof readFirstFreshnessStateSchema>;

export const readFirstRefreshStatusSchema = z.enum(["idle", "queued", "running", "complete"]);
export type ReadFirstRefreshStatus = z.infer<typeof readFirstRefreshStatusSchema>;

export const readFirstDemandSnapshotSchema = z.object({
  id: z.string().uuid(),
  windowType: z.string(),
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  sampleSize: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  measurementQuality: z.string(),
});
export type ReadFirstDemandSnapshot = z.infer<typeof readFirstDemandSnapshotSchema>;

export const readFirstDemandSummarySchema = z.object({
  snapshotId: z.string().uuid().nullable(),
  windowType: z.string().nullable(),
  gapCount: z.number().int().nonnegative(),
  driftCount: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
  measurementQuality: z.string().nullable(),
});
export type ReadFirstDemandSummary = z.infer<typeof readFirstDemandSummarySchema>;

export const readFirstPerformanceTimingSchema = z.object({
  intelligenceReadMs: z.number().nonnegative(),
  freshnessEvaluationMs: z.number().nonnegative(),
  refreshEnqueueMs: z.number().nonnegative(),
  totalReadFirstRequestMs: z.number().nonnegative(),
});
export type ReadFirstPerformanceTiming = z.infer<typeof readFirstPerformanceTimingSchema>;
