import { z } from "zod";

export const SOURCE_HEALTH_VERSION = "source_health_v1" as const;

export const sourceHealthStates = [
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
] as const;

export const sourceHealthStateSchema = z.enum(sourceHealthStates);
export const sourceHealthConfigStateSchema = z.enum(["configured", "missing", "disabled", "unknown"]);

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

export type SourceHealthState = z.infer<typeof sourceHealthStateSchema>;
export type SourceHealthConfigState = z.infer<typeof sourceHealthConfigStateSchema>;
export type SourceHealthV1Source = z.infer<typeof sourceHealthV1SourceSchema>;
export type SourceHealthV1 = z.infer<typeof sourceHealthV1Schema>;
export type SourceHealthCoverageLabel = SourceHealthV1["coverage"]["label"];

export const sourceHealthCoverageCopy: Record<SourceHealthCoverageLabel, string> = {
  full_coverage: "All planned sources completed successfully.",
  limited_coverage: "Some planned sources were unavailable or only partially completed.",
  severely_degraded: "Major source coverage was unavailable for this scan.",
};

const sourceHealthReadModelSourceSchema = sourceHealthV1SourceSchema.pick({
  state: true,
  available: true,
  retryable: true,
  plannedQueries: true,
  executedQueries: true,
  successfulQueries: true,
  failedQueries: true,
  zeroResultQueries: true,
  normalizedItems: true,
  degradedReason: true,
  partial: true,
}).extend({ sourceKey: z.string() });

export const sourceHealthV1ReadModelSchema = sourceHealthV1Schema.transform((value) => ({
  version: value.version,
  sources: Object.fromEntries(Object.entries(value.sources).map(([sourceKey, source]) => [sourceKey, {
    sourceKey,
    state: source.state,
    available: source.available,
    partial: source.partial,
    plannedQueries: source.plannedQueries,
    executedQueries: source.executedQueries,
    successfulQueries: source.successfulQueries,
    failedQueries: source.failedQueries,
    zeroResultQueries: source.zeroResultQueries,
    normalizedItems: source.normalizedItems,
    degradedReason: source.degradedReason,
    retryable: source.retryable,
  }])),
  coverage: {
    ...value.coverage,
    copy: sourceHealthCoverageCopy[value.coverage.label],
  },
})).pipe(z.object({
  version: z.literal(SOURCE_HEALTH_VERSION),
  sources: z.record(z.string(), sourceHealthReadModelSourceSchema),
  coverage: z.object({
    score: z.number().min(0).max(1),
    label: z.enum(["full_coverage", "limited_coverage", "severely_degraded"]),
    plannedSourceCount: z.number().int().nonnegative(),
    healthySourceCount: z.number().int().nonnegative(),
    degradedSourceCount: z.number().int().nonnegative(),
    unavailableSourceCount: z.number().int().nonnegative(),
    copy: z.string(),
  }),
}));

export type SourceHealthV1ReadModel = z.infer<typeof sourceHealthV1ReadModelSchema>;
