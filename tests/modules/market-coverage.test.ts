import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { projectGlobalCoverageObservation } from "../../src/server/modules/market-coverage/market-coverage.boundary";
import {
  MARKET_SOURCE_FAMILIES,
  MARKET_SOURCE_FAMILY_TAXONOMY_VERSION,
  normalizedConnectorEnvelopeSchema,
} from "../../src/server/modules/market-coverage/market-coverage.contracts";
import { deriveMarketCoveragePartitionIdentity } from "../../src/server/modules/market-coverage/market-coverage.identity";
import { evaluateMarketCoverage } from "../../src/server/modules/market-coverage/market-coverage.model";
import { createSaasCoverageProfile, defineCoverageProfile } from "../../src/server/modules/market-coverage/market-coverage.profiles";

const asOf = "2026-10-02T12:00:00.000Z";
const partition = deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social" });

function row(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "root-1", providerKey: "x", evidenceRole: "demand", observedAt: asOf,
    publishedAt: "2026-10-01T10:00:00.000Z", geographyCode: "US", languageCode: "en", surfaceSubtype: null, ...overrides,
  };
}

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    asOf, availability: "active", relevance: "relevant", expectedRole: "demand",
    rights: { state: "permitted", acquisitionAllowed: true, durableAnalysisAllowed: true, publicProjectionAllowed: null, rawRetentionClass: null },
    observations: [], minimumIndependentRoots: 2, freshnessDays: 30, concentrationThreshold: 0.75, duplicateThreshold: 0.75,
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "x", sourceFamily: "social", evidenceRole: "demand", visibility: "global_public",
    providerNativeId: "post-1", canonicalSourceIdentity: "x:post-1", sourceUrl: "https://example.test/post-1",
    publishedAt: "2026-10-01T10:00:00.000Z", retrievedAt: asOf, firstSeenAt: asOf, languageCode: null,
    geography: null, surfaceSubtype: null, conversationThreadIdentity: "conversation-1", authorEntityIdentity: null,
    authorIdentityPermission: "unknown", engagement: null, rightsProfileReference: null,
    retentionClassReference: null, publicProjectionEligibility: null, rawContentPolicy: "unknown",
    providerCost: null, rateLimit: null, ...overrides,
  };
}

describe("Market Coverage V1 identity and boundary", () => {
  it("derives reusable identities from reviewed market dimensions, independent of product/workspace", () => {
    const first = deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social" });
    const second = deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social" });
    expect(first).toEqual(second);
    expect(first.partitionKey).toMatch(/^market_coverage_partition_v1:[a-f0-9]{64}$/);
    expect(() => deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social", workspaceId: "w1" } as never)).toThrow();
    expect(() => deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social", productId: "p1" } as never)).toThrow();
    expect(() => deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "owned_support" } as never)).toThrow();
  });

  it("changes identity for geography, language, subtype, family, or market, never freshness/yield", () => {
    const base = deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social" });
    expect(deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "social", geographyCode: "GB" }).partitionKey).not.toBe(base.partitionKey);
    expect(deriveMarketCoveragePartitionIdentity({ verticalKey: "saas", marketKey: "project-management", sourceFamily: "community_forum" }).partitionKey).not.toBe(base.partitionKey);
  });

  it("keeps provider identity, source family, and evidence role as separate dimensions", () => {
    const profile = createSaasCoverageProfile();
    expect(profile.entries.some((entry) => entry.sourceFamily === "social" && entry.evidenceRole === "demand")).toBe(true);
    const result = evaluateMarketCoverage(evaluation({ observations: [row({ providerKey: "x" }), row({ conversationId: "root-2", providerKey: "bluesky" })] }));
    expect(result.metrics?.providerCount).toBe(2);
    expect(result.metrics?.independentRoots).toBe(2);
    expect(result.state).toBe("healthy");
    expect(MARKET_SOURCE_FAMILIES).toContain("reviews");
    expect(MARKET_SOURCE_FAMILY_TAXONOMY_VERSION).toBe("market_source_family_v1");
  });

  it("does not treat supply or context volume as demand", () => {
    const observations = [row({ evidenceRole: "supply" }), row({ conversationId: "root-2", evidenceRole: "context" })];
    const result = evaluateMarketCoverage(evaluation({ observations }));
    expect(result.state).toBe("undercovered");
    expect(result.metrics?.independentRoots).toBe(0);
  });

  it("rejects owned/private evidence from global Market Memory", () => {
    expect(() => normalizedConnectorEnvelopeSchema.parse(envelope({ evidenceRole: "owned_private" }))).toThrow();
    expect(() => normalizedConnectorEnvelopeSchema.parse(envelope({ sourceFamily: "owned_crm" }))).toThrow();
    const privateEnvelope = envelope({ visibility: "workspace_private", evidenceRole: "owned_private" });
    const projected = projectGlobalCoverageObservation({ envelope: privateEnvelope, partition, conversationId: "00000000-0000-4000-8000-000000000001", sourceItemId: "00000000-0000-4000-8000-000000000002", observedAt: asOf });
    expect(projected).toEqual({ eligible: false, reason: "workspace_private" });
    expect(() => defineCoverageProfile({ verticalKey: "saas", profileKey: "private-test", profileVersion: "1", entries: [{ sourceFamily: "owned_support", evidenceRole: "demand", relevant: true }] })).toThrow();
  });

  it("requires permission before retaining author identity and stores no text/payload", () => {
    expect(() => normalizedConnectorEnvelopeSchema.parse(envelope({ authorEntityIdentity: "author-1" }))).toThrow();
    const parsed = normalizedConnectorEnvelopeSchema.parse(envelope({ authorEntityIdentity: "permitted-ref", authorIdentityPermission: "permitted" }));
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain("payload");
  });

  it("rejects product/workspace-shaped fields instead of accepting tenant identity", () => {
    expect(() => normalizedConnectorEnvelopeSchema.parse(envelope({ workspaceId: "w1" }))).toThrow();
    expect(() => normalizedConnectorEnvelopeSchema.parse(envelope({ productId: "p1" }))).toThrow();
  });
});

describe("deterministic coverage states and components", () => {
  it("counts many source items on one canonical thread as one independent root", () => {
    const result = evaluateMarketCoverage(evaluation({ observations: [row(), row({ providerKey: "x", publishedAt: "2026-10-01T11:00:00.000Z" })] }));
    expect(result.metrics?.independentRoots).toBe(1);
    expect(result.metrics?.providerRootAttributions).toBe(1);
    expect(result.metrics?.duplicateRootRatio).toBe(0);
  });

  it("counts the same root on two providers as one root plus repeated-root attribution", () => {
    const result = evaluateMarketCoverage(evaluation({ observations: [row(), row({ providerKey: "bluesky" }), row({ conversationId: "root-2", providerKey: "reddit" })] }));
    expect(result.metrics?.independentRoots).toBe(2);
    expect(result.metrics?.providerRootAttributions).toBe(3);
    expect(result.metrics?.duplicateRootRatio).toBeCloseTo(1 / 3);
  });

  it("distinguishes unknown rights, unavailable, inactive, missing observations, and stale evidence", () => {
    expect(evaluateMarketCoverage(evaluation({ rights: { state: "unknown", acquisitionAllowed: null, durableAnalysisAllowed: null, publicProjectionAllowed: null, rawRetentionClass: null }, observations: [row()] })).state).toBe("unknown");
    expect(evaluateMarketCoverage(evaluation({ rights: { state: "restricted", acquisitionAllowed: null, durableAnalysisAllowed: null, publicProjectionAllowed: null, rawRetentionClass: null }, observations: [] })).state).toBe("unavailable");
    expect(evaluateMarketCoverage(evaluation({ availability: "inactive" })).state).toBe("inactive");
    expect(evaluateMarketCoverage(evaluation()).state).toBe("undercovered");
    expect(evaluateMarketCoverage(evaluation({ observations: [row({ observedAt: "2026-08-01T10:00:00.000Z" })] })).state).toBe("stale");
  });

  it("keeps missing time and geography explicit instead of fabricating dimensions", () => {
    const result = evaluateMarketCoverage(evaluation({ observations: [row({ publishedAt: null, geographyCode: null })] }));
    expect(result.metrics?.publishedMonthBuckets).toBe(0);
    expect(result.metrics?.rootsWithoutPublishedTime).toBe(1);
    expect(result.metrics?.distinctGeographies).toBe(0);
    expect(result.metrics?.rootsWithoutGeography).toBe(1);
  });

  it("does not let roots from another geography/language/surface inflate a partition slice", () => {
    const result = evaluateMarketCoverage(evaluation({
      geographyCode: "us", languageCode: "EN", surfaceSubtype: "thread",
      observations: [
        row({ conversationId: "matched", geographyCode: "US", languageCode: "en", surfaceSubtype: "thread" }),
        row({ conversationId: "other", geographyCode: "GB", languageCode: "en", surfaceSubtype: "thread" }),
        row({ conversationId: "different-surface", geographyCode: "US", languageCode: "en", surfaceSubtype: "video" }),
      ],
    }));
    expect(result.metrics?.independentRoots).toBe(1);
    expect(result.metrics?.distinctGeographies).toBe(1);
  });

  it("represents SaaS, ecommerce, and local-business profiles with one generic schema", () => {
    const saas = createSaasCoverageProfile();
    const ecommerce = defineCoverageProfile({ verticalKey: "ecommerce", profileKey: "fixture-ecommerce", profileVersion: "fixture-1", entries: [{ sourceFamily: "marketplace", evidenceRole: "supply", relevant: true }, { sourceFamily: "reviews", evidenceRole: "demand", relevant: true }] });
    const local = defineCoverageProfile({ verticalKey: "local_business", profileKey: "fixture-local", profileVersion: "fixture-1", entries: [{ sourceFamily: "maps_reviews", evidenceRole: "demand", relevant: true }, { sourceFamily: "local_directory", evidenceRole: "supply", relevant: true }] });
    expect(saas.verticalKey).toBe("saas");
    expect(saas.defaultAvailability).toBe("unknown");
    expect(saas.defaultRightsState).toBe("unknown");
    expect(ecommerce.entries.map((entry) => entry.sourceFamily)).toContain("marketplace");
    expect(local.entries.map((entry) => entry.sourceFamily)).toContain("maps_reviews");
    expect(() => defineCoverageProfile({ verticalKey: "saas", profileKey: "private", profileVersion: "1", entries: [{ sourceFamily: "owned_crm", evidenceRole: "owned_private", relevant: true }] })).toThrow();
  });
});
