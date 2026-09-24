import { describe, expect, it } from "vitest";

import { scanResultSummarySchema } from "../../src/server/modules/operations/product-demand-scan.schemas";
import { classifySourceHealthAlert, classifySourceHealthAlerts } from "../../src/server/modules/operations/source-health-alerts";
import { getScanSourceHealthReadModel, legacyCoverageLabel } from "../../src/server/modules/operations/source-health-read-model";
import { sourceHealthCoverageCopy, type SourceHealthV1 } from "../../src/shared/source-health-v1";

function health(overrides: Partial<SourceHealthV1> = {}): SourceHealthV1 {
  return {
    version: "source_health_v1",
    sources: {
      github: {
        state: "healthy_with_results",
        available: true,
        retryable: false,
        plannedQueries: 1,
        executedQueries: 1,
        successfulQueries: 1,
        failedQueries: 0,
        zeroResultQueries: 0,
        normalizedItems: 2,
        providerStatus: null,
        providerCode: null,
        retryAfterSeconds: null,
        configState: "configured",
        lastSuccessfulAt: null,
        degradedReason: null,
        partial: false,
        coverageFraction: 1,
        coverageWeight: 1,
      },
    },
    coverage: {
      score: 1,
      label: "full_coverage",
      plannedSourceCount: 1,
      healthySourceCount: 1,
      degradedSourceCount: 0,
      unavailableSourceCount: 0,
    },
    ...overrides,
  };
}

describe("Source Health V1 read model and alert policy", () => {
  it("uses the canonical copy for full, limited, and severe coverage", () => {
    expect(sourceHealthCoverageCopy.full_coverage).toBe("All planned sources completed successfully.");
    expect(sourceHealthCoverageCopy.limited_coverage).toBe("Some planned sources were unavailable or only partially completed.");
    expect(sourceHealthCoverageCopy.severely_degraded).toBe("Major source coverage was unavailable for this scan.");
  });

  it("projects compact source detail and excludes provider internals", () => {
    const base = health();
    const result = getScanSourceHealthReadModel(health({
      sources: {
        github: {
          ...base.sources.github,
          state: "temporary_provider_error",
          available: true,
          retryable: true,
          partial: true,
          plannedQueries: 2,
          executedQueries: 2,
          successfulQueries: 1,
          failedQueries: 1,
          normalizedItems: 3,
          providerStatus: 503,
          providerCode: "HTTP_503",
          degradedReason: "temporary_provider_error",
        },
      },
      coverage: { ...base.coverage, label: "limited_coverage", score: 0.5, degradedSourceCount: 1 },
    }));
    expect(result).toMatchObject({ coverage: { label: "limited_coverage", copy: sourceHealthCoverageCopy.limited_coverage } });
    expect(result?.sources.github).toEqual(expect.objectContaining({ sourceKey: "github", state: "temporary_provider_error", plannedQueries: 2, executedQueries: 2, normalizedItems: 3, degradedReason: "temporary_provider_error", retryable: true }));
    expect(result?.sources.github).not.toHaveProperty("providerCode");
    expect(result?.sources.github).not.toHaveProperty("providerStatus");
    expect(result?.sources.github).not.toHaveProperty("rawBody");
  });

  it("keeps invalid or absent historical health out of the canonical read model", () => {
    expect(getScanSourceHealthReadModel(undefined)).toBeNull();
    expect(getScanSourceHealthReadModel({ version: "source_health_v1" })).toBeNull();
    expect(legacyCoverageLabel({ resultState: "complete_with_warnings" })).toBe("limited_coverage");
    expect(legacyCoverageLabel({ resultState: "completed" })).toBeNull();
  });

  it("preserves sourceHealthV1 in the dashboard result summary", () => {
    const parsed = scanResultSummarySchema.parse({ sourceHealthV1: health(), sources: ["github"] });
    expect(parsed.sourceHealthV1).toEqual(getScanSourceHealthReadModel(health()));
    expect(parsed.sourceHealthV1?.sources.github).not.toHaveProperty("providerCode");
  });

  it("does not alert for healthy results or healthy zero results", () => {
    const healthy = health().sources.github;
    expect(classifySourceHealthAlert({ sourceKey: "github", source: healthy })).toBeNull();
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...healthy, state: "healthy_zero_results", normalizedItems: 0 } })).toBeNull();
  });

  it("alerts immediately for planned auth, quota, and misconfiguration failures", () => {
    for (const state of ["auth_error", "quota_exhausted", "misconfigured"] as const) {
      const alert = classifySourceHealthAlert({ sourceKey: "github", source: { ...health().sources.github, state, available: false, retryable: state !== "misconfigured" } });
      expect(alert).toMatchObject({ kind: "immediate", severity: "critical", state });
    }
  });

  it("defers one temporary or rate failure until recurrence is known", () => {
    const source = health().sources.github;
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "temporary_provider_error", available: false, retryable: true } })).toBeNull();
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "rate_limited", available: false, retryable: true } })).toBeNull();
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "temporary_provider_error", available: false, retryable: true }, repeated: true })).toMatchObject({ kind: "persistent" });
  });

  it("escalates high-priority permanent failures and repeated unknown failures", () => {
    const source = health().sources.github;
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "permanent_provider_error", available: false }, highPriority: true })).toMatchObject({ kind: "persistent" });
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "unknown_failure", available: false }, repeated: true })).toMatchObject({ kind: "persistent" });
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "unknown_failure", available: false }, highPriority: true })).toMatchObject({ kind: "persistent" });
  });

  it("keeps planned budget and disabled states informational", () => {
    const source = health().sources.github;
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "budget_limited", available: false } })).toMatchObject({ kind: "informational", severity: "info" });
    expect(classifySourceHealthAlert({ sourceKey: "github", source: { ...source, state: "disabled", available: false } })).toMatchObject({ kind: "informational", severity: "info" });
  });

  it("returns deterministic source alert ordering and no alert for unplanned entries", () => {
    const base = health();
    const value = health({ sources: {
      zed: { ...base.sources.github, state: "auth_error", available: false },
      github: { ...base.sources.github, state: "quota_exhausted", available: false },
      unplanned: { ...base.sources.github, state: "auth_error", available: false, plannedQueries: 0 },
    } });
    expect(classifySourceHealthAlerts(value)).toEqual([
      expect.objectContaining({ sourceKey: "github", kind: "immediate" }),
      expect.objectContaining({ sourceKey: "zed", kind: "immediate" }),
    ]);
  });
});
