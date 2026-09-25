import type { DemandMapConcept, DemandMapResolvedMember } from "../demand-intelligence/demand-map.policy";
import type { GeoPublicLocation } from "./geo.schemas";
import { reliableLocation, regionReliableLocation } from "./geography.service";

/**
 * Wanterest Layer 9D: Geography as a facet over live-validated current
 * evidence, never part of concept/cluster identity. Pure read-side policy —
 * currentness comes only from the already-proven Stage 2G/9A member
 * resolution (DemandCurrentnessService + buildDemandMap); this module never
 * re-derives lifecycle rules. See docs/architecture.md §19.
 */

export const CURRENT_GEOGRAPHY_POLICY_VERSION = "current_geography_v1" as const;
/** Same minimum used by the legacy regional-drilldown gate — not a new threshold. */
export const GEOGRAPHY_REGION_MIN_SIGNALS = 5;

export type CurrentGeographyRepresentativeSignal = {
  conversationId: string;
  source: string;
  evidenceAt: string;
  excerpt: string;
};

export type CurrentGeographyRegion = {
  regionCode: string;
  regionName: string;
  currentEvidenceCount: number;
};

export type CurrentGeographyCountry = {
  countryCode: string;
  countryName: string;
  currentEvidenceCount: number;
  percentageOfAllCurrentEvidence: number;
  percentageOfKnownLocationEvidence: number;
  regions: CurrentGeographyRegion[];
  representativeSignals: CurrentGeographyRepresentativeSignal[];
};

export type CurrentGeographyReadModel = {
  policyVersion: typeof CURRENT_GEOGRAPHY_POLICY_VERSION;
  clusteringVersion: string;
  generatedAt: string;
  anchorConceptKey: string | null;
  currentEvidenceCount: number;
  knownLocationCount: number;
  unknownLocationCount: number;
  reliableCoveragePercent: number;
  countries: CurrentGeographyCountry[];
  diagnostics: { clustersRead: number; membershipsRead: number; statesRead: number; statesTruncated: boolean };
};

export type CurrentGeographyMember = { member: DemandMapResolvedMember; excerpt: string; location: GeoPublicLocation };

function percent(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

/**
 * Guardrail 1 (product-wide dedupe): builds the member set ONCE, keyed by
 * conversation_id, across every current concept, before any geography
 * aggregation runs. Product-wide totals are never the sum of per-concept
 * totals — a conversation contributing to both "pricing" and "api_access"
 * counts once here even though it legitimately appears in both concepts'
 * own scoped views.
 */
export function productWideCurrentMembers(concepts: DemandMapConcept[]): DemandMapResolvedMember[] {
  const seen = new Map<string, DemandMapResolvedMember>();
  for (const concept of concepts) {
    if (concept.status !== "current") continue;
    for (const cluster of concept.clusters) {
      for (const member of cluster.members) {
        if (member.contributes && !seen.has(member.conversationId)) seen.set(member.conversationId, member);
      }
    }
  }
  return [...seen.values()];
}

/** Concept-scoped dedupe: by conversation_id WITHIN this one concept only. */
export function conceptScopedCurrentMembers(concept: DemandMapConcept | undefined): DemandMapResolvedMember[] {
  if (!concept || concept.status !== "current") return [];
  const seen = new Map<string, DemandMapResolvedMember>();
  for (const cluster of concept.clusters) {
    for (const member of cluster.members) {
      if (member.contributes && !seen.has(member.conversationId)) seen.set(member.conversationId, member);
    }
  }
  return [...seen.values()];
}

/**
 * Rolls a deduplicated current-member set (already scoped product-wide or to
 * one concept by the caller) into the v2 read model. Never re-derives
 * currentness or dedupe itself — both must already be correct on input.
 */
export function buildCurrentGeography(input: {
  members: CurrentGeographyMember[];
  clusteringVersion: string;
  generatedAt: Date;
  anchorConceptKey: string | null;
  diagnostics: CurrentGeographyReadModel["diagnostics"];
}): CurrentGeographyReadModel {
  const currentEvidenceCount = input.members.length;
  const known = input.members.filter((row) => reliableLocation(row.location));
  const knownLocationCount = known.length;
  const unknownLocationCount = currentEvidenceCount - knownLocationCount;

  const byCountry = new Map<string, CurrentGeographyMember[]>();
  for (const row of known) {
    const code = row.location.countryCode!;
    byCountry.set(code, [...(byCountry.get(code) ?? []), row]);
  }

  const countries: CurrentGeographyCountry[] = [...byCountry.entries()]
    .map(([countryCode, rows]) => {
      const byRegion = new Map<string, CurrentGeographyMember[]>();
      for (const row of rows) {
        if (!regionReliableLocation(row.location)) continue;
        const code = row.location.regionCode!;
        byRegion.set(code, [...(byRegion.get(code) ?? []), row]);
      }
      const regions: CurrentGeographyRegion[] = [...byRegion.entries()]
        .filter(([, regionRows]) => regionRows.length >= GEOGRAPHY_REGION_MIN_SIGNALS)
        .map(([regionCode, regionRows]) => ({ regionCode, regionName: regionRows[0]!.location.regionName!, currentEvidenceCount: regionRows.length }))
        .sort((left, right) => right.currentEvidenceCount - left.currentEvidenceCount || left.regionCode.localeCompare(right.regionCode));
      return {
        countryCode,
        countryName: rows[0]!.location.countryName ?? countryCode,
        currentEvidenceCount: rows.length,
        percentageOfAllCurrentEvidence: percent(rows.length, currentEvidenceCount),
        percentageOfKnownLocationEvidence: percent(rows.length, knownLocationCount),
        regions,
        representativeSignals: [...rows]
          .sort((left, right) => right.member.evidenceAt.localeCompare(left.member.evidenceAt))
          .slice(0, 5)
          .map((row) => ({ conversationId: row.member.conversationId, source: row.member.sourceKey, evidenceAt: row.member.evidenceAt, excerpt: row.excerpt })),
      };
    })
    .sort((left, right) => right.currentEvidenceCount - left.currentEvidenceCount || left.countryName.localeCompare(right.countryName));

  return {
    policyVersion: CURRENT_GEOGRAPHY_POLICY_VERSION,
    clusteringVersion: input.clusteringVersion,
    generatedAt: input.generatedAt.toISOString(),
    anchorConceptKey: input.anchorConceptKey,
    currentEvidenceCount,
    knownLocationCount,
    unknownLocationCount,
    reliableCoveragePercent: percent(knownLocationCount, currentEvidenceCount),
    countries,
    diagnostics: input.diagnostics,
  };
}

export type CurrentGeographyHeadline = { state: "current" | "no_current_demand"; title: string; body: string };

/** Headline copy built only from the v2 model — never from legacy/historical counts. */
export function currentGeographyHeadline(model: CurrentGeographyReadModel): CurrentGeographyHeadline {
  if (model.currentEvidenceCount > 0) {
    return {
      state: "current",
      title: "Current geographic demand",
      body: `${model.currentEvidenceCount} current conversation${model.currentEvidenceCount === 1 ? "" : "s"} across ${model.countries.length} known ${model.countries.length === 1 ? "country" : "countries"}${model.unknownLocationCount ? `, ${model.unknownLocationCount} unknown` : ""}.`,
    };
  }
  return {
    state: "no_current_demand",
    title: "No current geographic demand confirmed",
    body: "Nothing is counted as current geography until new qualifying evidence arrives. Historical geography below includes evidence that has since been re-evaluated, invalidated, retracted, or is older than 90 days.",
  };
}
