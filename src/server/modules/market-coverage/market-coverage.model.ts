import "server-only";

import { coverageEvaluationInputSchema, type MarketCoverageState } from "./market-coverage.contracts";

export type CoverageEvaluation = {
  state: MarketCoverageState;
  metrics: null | {
    independentRoots: number;
    providerCount: number;
    providerRootAttributions: number;
    duplicateRootRatio: number | null;
    maxProviderRootShare: number | null;
    publishedMonthBuckets: number;
    rootsWithoutPublishedTime: number;
    distinctGeographies: number;
    rootsWithoutGeography: number;
    latestObservedAt: string | null;
  };
  explanation: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic, explainable family-state evaluation; it deliberately produces no coverage percentage or composite score. */
export function evaluateMarketCoverage(input: unknown): CoverageEvaluation {
  const value = coverageEvaluationInputSchema.parse(input);
  if (value.relevance === "unknown" || value.availability === "unknown" || value.rights.state === "unknown") {
    return { state: "unknown", metrics: null, explanation: "Relevance, availability, or durable-use rights are not established." };
  }
  if (value.availability === "unavailable" || value.rights.state === "restricted" || value.rights.state === "unavailable"
      || value.rights.acquisitionAllowed === false || value.rights.durableAnalysisAllowed === false) {
    return { state: "unavailable", metrics: null, explanation: "The surface is unavailable or current rights do not permit durable analysis." };
  }
  if (value.rights.acquisitionAllowed === null || value.rights.durableAnalysisAllowed === null) {
    return { state: "unknown", metrics: null, explanation: "Durable analysis permission is not established." };
  }
  if (value.availability === "inactive") {
    return { state: "inactive", metrics: null, explanation: "This relevant surface is intentionally inactive." };
  }

  const expectedObservations = value.observations.filter((row) => row.evidenceRole === value.expectedRole
    && Date.parse(row.observedAt) <= Date.parse(value.asOf)
    && (value.geographyCode === null || row.geographyCode === value.geographyCode)
    && (value.languageCode === null || (row.languageCode !== null && row.languageCode.toLowerCase() === value.languageCode.toLowerCase()))
    && (value.surfaceSubtype === null || row.surfaceSubtype === value.surfaceSubtype));
  const latestObservedAt = expectedObservations.reduce<string | null>((latest, row) =>
    !latest || Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest, null);
  const windowStart = Date.parse(value.asOf) - value.measurementWindowDays * DAY_MS;
  const inWindow = expectedObservations.filter((row) => Date.parse(row.observedAt) >= windowStart);
  const roots = new Set(inWindow.map((row) => row.conversationId));
  const byProvider = new Map<string, Set<string>>();
  const publishedMonths = new Set<string>();
  const geographies = new Set<string>();
  const rootsWithoutTime = new Set<string>();
  const rootsWithoutGeography = new Set<string>();
  for (const row of inWindow) {
    const providerRoots = byProvider.get(row.providerKey) ?? new Set<string>();
    providerRoots.add(row.conversationId);
    byProvider.set(row.providerKey, providerRoots);
    if (row.publishedAt) publishedMonths.add(row.publishedAt.slice(0, 7));
    else rootsWithoutTime.add(row.conversationId);
    if (row.geographyCode) geographies.add(row.geographyCode);
    else rootsWithoutGeography.add(row.conversationId);
  }

  const providerRootAttributions = [...byProvider.values()].reduce((sum, providerRoots) => sum + providerRoots.size, 0);
  const maxProviderRoots = Math.max(0, ...[...byProvider.values()].map((providerRoots) => providerRoots.size));
  const duplicateRootRatio = providerRootAttributions > 0 ? (providerRootAttributions - roots.size) / providerRootAttributions : null;
  const maxProviderRootShare = providerRootAttributions > 0 ? maxProviderRoots / providerRootAttributions : null;
  const metrics = {
    independentRoots: roots.size,
    providerCount: byProvider.size,
    providerRootAttributions,
    duplicateRootRatio,
    maxProviderRootShare,
    publishedMonthBuckets: publishedMonths.size,
    rootsWithoutPublishedTime: rootsWithoutTime.size,
    distinctGeographies: geographies.size,
    rootsWithoutGeography: rootsWithoutGeography.size,
    latestObservedAt,
  };

  if (latestObservedAt && Date.parse(latestObservedAt) < Date.parse(value.asOf) - value.freshnessDays * DAY_MS) {
    return { state: "stale", metrics, explanation: `The latest observation is older than the ${value.freshnessDays}-day freshness window.` };
  }
  if (roots.size === 0) return { state: "undercovered", metrics, explanation: "No independent canonical roots were observed for this family and role." };
  if (roots.size < value.minimumIndependentRoots) {
    return { state: "observed", metrics, explanation: `Observed ${roots.size} independent roots; ${value.minimumIndependentRoots} are required for the configured minimum.` };
  }
  if ((maxProviderRootShare ?? 0) >= value.concentrationThreshold || (duplicateRootRatio ?? 0) >= value.duplicateThreshold) {
    return { state: "concentrated", metrics, explanation: "Independent roots meet the minimum, but provider concentration or repeated-root attribution exceeds its configured threshold." };
  }
  return { state: "healthy", metrics, explanation: `Fresh evidence meets the ${value.minimumIndependentRoots}-root minimum without exceeding concentration thresholds.` };
}
