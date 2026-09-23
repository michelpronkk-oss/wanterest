import { z } from "zod";

export const geoConfidenceSchema = z.enum(["high", "medium", "low", "unknown"]);
export type GeoConfidence = z.infer<typeof geoConfidenceSchema>;

export const geoEvidenceTypeSchema = z.enum([
  "provider_country",
  "public_profile_location",
  "review_region",
  "structured_metadata",
  "explicit_thread_context",
  "language_only",
  "unknown",
]);
export type GeoEvidenceType = z.infer<typeof geoEvidenceTypeSchema>;

/** Persisted on source_items.metadata. rawLocation is never part of a public read model. */
export const geoEvidenceSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
  countryName: z.string().trim().min(1).max(160).nullable(),
  regionCode: z.string().trim().max(32).nullable(),
  regionName: z.string().trim().min(1).max(160).nullable(),
  city: z.string().trim().min(1).max(160).nullable(),
  confidence: geoConfidenceSchema,
  evidenceType: geoEvidenceTypeSchema,
  rawLocation: z.string().trim().max(500).nullable(),
}).strict();
export type GeoEvidence = z.infer<typeof geoEvidenceSchema>;

export const geoPublicLocationSchema = geoEvidenceSchema.omit({ rawLocation: true });
export type GeoPublicLocation = z.infer<typeof geoPublicLocationSchema>;

export const geoSampleStateSchema = z.enum(["insufficient_data", "emerging", "directional", "higher_confidence"]);
export type GeoSampleState = z.infer<typeof geoSampleStateSchema>;

export const geoTrendSchema = z.object({
  currentCount: z.number().int().nonnegative(),
  previousCount: z.number().int().nonnegative(),
  percentage: z.number().nullable(),
  direction: z.enum(["growing", "cooling", "stable", "insufficient_data"]),
  hasEnoughHistory: z.boolean(),
}).strict();
export type GeoTrend = z.infer<typeof geoTrendSchema>;
