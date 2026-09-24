import { describe, expect, it } from "vitest";

import { aggregateSourceHealthV1, sourceHealthV1Schema, type SourceHealthPlannedQuery, type SourceHealthPlannedSource, type SourceHealthQueryArtifact } from "../../src/server/modules/operations/source-health-aggregation";

function source(sourceKey: string, priority: SourceHealthPlannedSource["priority"] = "medium", plannedQueries = 1, overrides: Partial<SourceHealthPlannedSource> = {}): SourceHealthPlannedSource {
  return { sourceKey, priority, plannedQueries, ...overrides };
}

function query(queryPlanId: string, sourceKey: string, priority: SourceHealthPlannedQuery["priority"] = "medium"): SourceHealthPlannedQuery {
  return { queryPlanId, sourceKey, priority };
}

function artifact(queryPlanId: string, sourceKey: string, executionStatus: SourceHealthQueryArtifact["executionStatus"], normalizedItems = 0, overrides: Partial<SourceHealthQueryArtifact> = {}): SourceHealthQueryArtifact {
  return { queryPlanId, sourceKey, executionStatus, normalizedItems, ...overrides };
}

function aggregate(plannedSources: SourceHealthPlannedSource[], plannedQueries: SourceHealthPlannedQuery[], executions: SourceHealthQueryArtifact[]) {
  return aggregateSourceHealthV1({ plannedSources, plannedQueries, executions });
}

describe("Source Health V1 source aggregation", () => {
  it("aggregates one successful and one failed query as an available partial source", () => {
    const result = aggregate(
      [source("github", "high", 2)],
      [query("github-1", "github", "high"), query("github-2", "github", "high")],
      [artifact("github-1", "github", "completed_with_results", 3), artifact("github-2", "github", "failed", 0, { providerCode: "HTTP_503" })],
    );
    expect(result.sources.github).toMatchObject({ state: "temporary_provider_error", available: true, retryable: true, plannedQueries: 2, executedQueries: 2, successfulQueries: 1, failedQueries: 1, normalizedItems: 3, partial: true, coverageFraction: 0.5 });
    expect(result.coverage.label).toBe("limited_coverage");
  });

  it("classifies an all-failed source by the highest-severity failure", () => {
    const result = aggregate(
      [source("github", "very_high", 2)],
      [query("github-1", "github", "very_high"), query("github-2", "github", "very_high")],
      [artifact("github-1", "github", "failed", 0, { providerCode: "HTTP_503" }), artifact("github-2", "github", "failed", 0, { providerCode: "AUTH_FAILED" })],
    );
    expect(result.sources.github).toMatchObject({ state: "auth_error", available: false, retryable: true, successfulQueries: 0, failedQueries: 2, coverageFraction: 0 });
    expect(result.coverage.label).toBe("severely_degraded");
  });

  it("treats all successful zero-result queries as healthy", () => {
    const result = aggregate(
      [source("hacker-news", "medium", 2)],
      [query("hn-1", "hacker-news"), query("hn-2", "hacker-news")],
      [artifact("hn-1", "hacker-news", "completed_zero_results"), artifact("hn-2", "hacker-news", "completed_zero_results")],
    );
    expect(result.sources["hacker-news"]).toMatchObject({ state: "healthy_zero_results", available: true, plannedQueries: 2, executedQueries: 2, successfulQueries: 2, failedQueries: 0, zeroResultQueries: 2, coverageFraction: 1 });
    expect(result.coverage).toMatchObject({ score: 1, label: "full_coverage" });
  });

  it("treats mixed successful zero and result queries as full source coverage", () => {
    const result = aggregate(
      [source("g2", "high", 2)],
      [query("g2-1", "g2", "high"), query("g2-2", "g2", "high")],
      [artifact("g2-1", "g2", "completed_zero_results"), artifact("g2-2", "g2", "completed_with_results", 2)],
    );
    expect(result.sources.g2).toMatchObject({ state: "healthy_with_results", available: true, successfulQueries: 2, zeroResultQueries: 1, normalizedItems: 2, coverageFraction: 1 });
  });

  it("keeps an intentional budget bound informational rather than failed", () => {
    const result = aggregate(
      [source("x", "high", 3, { budgetLimited: true, executionStatus: "budget_limited" })],
      [query("x-1", "x", "high"), query("x-2", "x", "high"), query("x-3", "x", "high")],
      [artifact("x-1", "x", "completed_with_results", 2), artifact("x-2", "x", "completed_zero_results"), artifact("x-3", "x", "budget_limited")],
    );
    expect(result.sources.x).toMatchObject({ state: "healthy_with_results", available: true, retryable: false, plannedQueries: 3, executedQueries: 2, successfulQueries: 2, failedQueries: 0, budgetLimitedQueries: 1, coverageFraction: 1, partial: false });
    expect(result.coverage).toMatchObject({ score: 1, label: "full_coverage" });
  });

  it("keeps real provider failures degrading coverage when a budget bound is also present", () => {
    const result = aggregate(
      [source("x", "high", 3, { budgetLimited: true, executionStatus: "completed" })],
      [query("x-1", "x", "high"), query("x-2", "x", "high"), query("x-3", "x", "high")],
      [artifact("x-1", "x", "completed_with_results", 2), artifact("x-2", "x", "failed", 0, { providerCode: "HTTP_503" }), artifact("x-3", "x", "budget_limited")],
    );
    expect(result.sources.x).toMatchObject({ state: "temporary_provider_error", available: true, plannedQueries: 3, executedQueries: 2, successfulQueries: 1, failedQueries: 1, budgetLimitedQueries: 1, coverageFraction: 0.5, partial: true });
    expect(result.coverage.label).toBe("limited_coverage");
  });

  it.each([
    ["rate limiting", "rate_limited" as const, "RATE_LIMITED", "rate_limited" as const],
    ["quota exhaustion", "provider_error" as const, "QUOTA_EXCEEDED", "quota_exhausted" as const],
    ["authentication failure", "provider_error" as const, "AUTH_FAILED", "auth_error" as const],
  ])("keeps %s degrading coverage despite an intentional budget bound", (_label, executionStatus, providerCode, expectedState) => {
    const result = aggregate(
      [source("x", "high", 3, { budgetLimited: true, executionStatus: "completed" })],
      [query("x-1", "x", "high"), query("x-2", "x", "high"), query("x-3", "x", "high")],
      [artifact("x-1", "x", "completed_with_results", 2), artifact("x-2", "x", executionStatus, 0, { providerCode }), artifact("x-3", "x", "budget_limited")],
    );
    expect(result.sources.x).toMatchObject({ state: expectedState, failedQueries: 1, budgetLimitedQueries: 1, coverageFraction: 0.5 });
    expect(result.coverage.label).toBe("limited_coverage");
  });

  it("classifies a planned missing-configuration source without an auth error", () => {
    const result = aggregate([source("youtube", "high", 1, { controlState: "misconfigured", configurationState: "missing", executionStatus: "unavailable", providerCode: "MISSING_CREDENTIALS" })], [query("youtube-1", "youtube", "high")], []);
    expect(result.sources.youtube).toMatchObject({ state: "misconfigured", available: false, retryable: false, configState: "missing", providerCode: "MISSING_CREDENTIALS", executedQueries: 0 });
  });

  it("classifies an explicitly disabled planned source", () => {
    const result = aggregate([source("github", "high", 1, { controlState: "disabled", executionStatus: "disabled" })], [query("github-1", "github", "high")], []);
    expect(result.sources.github).toMatchObject({ state: "disabled", available: false, retryable: false, configState: "disabled", coverageFraction: 0 });
  });

  it("excludes unplanned sources from source output and the coverage denominator", () => {
    const result = aggregate([source("github", "medium")], [query("github-1", "github")], [artifact("github-1", "github", "completed_zero_results"), artifact("x-1", "x", "failed", 0, { providerCode: "AUTH_FAILED" })]);
    expect(result.sources).toEqual(expect.objectContaining({ github: expect.any(Object) }));
    expect(result.sources.x).toBeUndefined();
    expect(result.coverage.plannedSourceCount).toBe(1);
    expect(result.coverage.score).toBe(1);
  });

  it("uses the specified failure precedence and aggregates retryability", () => {
    const result = aggregate(
      [source("github", "high", 3)],
      [query("github-1", "github"), query("github-2", "github"), query("github-3", "github")],
      [
        artifact("github-1", "github", "failed", 0, { providerCode: "HTTP_503" }),
        artifact("github-2", "github", "failed", 0, { providerCode: "RATE_LIMITED" }),
        artifact("github-3", "github", "failed", 0, { providerCode: "QUOTA_EXCEEDED" }),
      ],
    );
    expect(result.sources.github.state).toBe("quota_exhausted");
    expect(result.sources.github.retryable).toBe(true);
  });

  it("computes deterministic weighted coverage from existing routing priority", () => {
    const input = {
      plannedSources: [source("github", "very_high"), source("public-web", "low")],
      plannedQueries: [query("github-1", "github", "very_high"), query("web-1", "public-web", "low")],
      executions: [artifact("github-1", "github", "completed_with_results", 1), artifact("web-1", "public-web", "failed", 0, { providerCode: "HTTP_503" })],
    };
    const first = aggregateSourceHealthV1(input);
    const second = aggregateSourceHealthV1(input);
    expect(first).toEqual(second);
    expect(first.sources.github.coverageWeight).toBe(1);
    expect(first.sources["public-web"].coverageWeight).toBe(0.25);
    expect(first.coverage.score).toBe(0.8);
    expect(first.coverage.label).toBe("limited_coverage");
  });

  it("marks a complete failure of the highest-priority source as severe", () => {
    const result = aggregate(
      [source("github", "very_high"), source("hacker-news", "low")],
      [query("github-1", "github", "very_high"), query("hn-1", "hacker-news", "low")],
      [artifact("github-1", "github", "failed", 0, { providerCode: "HTTP_503" }), artifact("hn-1", "hacker-news", "completed_with_results", 1)],
    );
    expect(result.coverage.label).toBe("severely_degraded");
  });

  it("does not infer availability from normalized items when the query failed", () => {
    const result = aggregate([source("github", "high")], [query("github-1", "github", "high")], [artifact("github-1", "github", "failed", 4, { providerCode: "MALFORMED_PROVIDER_RESPONSE" })]);
    expect(result.sources.github).toMatchObject({ state: "permanent_provider_error", available: false, normalizedItems: 4, successfulQueries: 0 });
  });

  it("classifies G2 no-match as healthy zero-result coverage", () => {
    const result = aggregate([source("g2", "high")], [query("g2-1", "g2", "high")], [artifact("g2-1", "g2", "completed_zero_results")]);
    expect(result.sources.g2).toMatchObject({ state: "healthy_zero_results", available: true, coverageFraction: 1, providerCode: null });
    expect(result.coverage.label).toBe("full_coverage");
  });

  it("does not include qualification or materialization fields", () => {
    const result = aggregate([source("g2")], [query("g2-1", "g2")], [artifact("g2-1", "g2", "completed_zero_results")]);
    expect(sourceHealthV1Schema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty("qualification");
    expect(result).not.toHaveProperty("materialization");
  });
});
