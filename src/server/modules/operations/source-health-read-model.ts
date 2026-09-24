import {
  sourceHealthV1ReadModelSchema,
  type SourceHealthV1ReadModel,
} from "@/shared/source-health-v1";

export type SourceHealthCoverageLabel = SourceHealthV1ReadModel["coverage"]["label"];

export { sourceHealthCoverageCopy } from "@/shared/source-health-v1";

export type SourceHealthReadModel = SourceHealthV1ReadModel;

/**
 * Projects the persisted scan diagnostic into a bounded read model. Provider
 * payloads, credentials, and provider-specific response details never cross
 * this boundary.
 */
export function getScanSourceHealthReadModel(value: unknown): SourceHealthReadModel | null {
  const parsed = sourceHealthV1ReadModelSchema.safeParse(value);
  if (!parsed.success) return null;
  const sourceEntries = Object.entries(parsed.data.sources).sort(([left], [right]) => left.localeCompare(right));
  return {
    version: parsed.data.version,
    sources: Object.fromEntries(sourceEntries),
    coverage: parsed.data.coverage,
  };
}

export function sourceHealthCoverageLabel(value: unknown): SourceHealthCoverageLabel | null {
  return getScanSourceHealthReadModel(value)?.coverage.label ?? null;
}

/** Historical results pre-dating Source Health V1 have no canonical health label. */
export function legacyCoverageLabel(input: { resultState?: unknown; partial?: boolean }): "limited_coverage" | null {
  return input.resultState === "complete_with_warnings" || input.partial === true ? "limited_coverage" : null;
}
