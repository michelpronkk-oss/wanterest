import { describe, expect, it } from "vitest";

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { DemandClusteringService, InMemoryDemandClusteringRepository, type DemandClusteringEvidence } from "../../src/server/modules/demand-intelligence";
import { InMemoryIntelligenceRepository } from "../../src/server/modules/intelligence/intelligence.repository";
import { CurrentGeographyService } from "../../src/server/modules/geography/current-geography.service";
import { buildCurrentGeography, conceptScopedCurrentMembers, currentGeographyHeadline, productWideCurrentMembers, type CurrentGeographyMember } from "../../src/server/modules/geography/current-geography.policy";
import { engineVersionId, now, productA, productA2, productB, seedEvidence, workspaceA, workspaceB } from "./demand-clustering.fixtures";
import type { GeoEvidence } from "../../src/server/modules/geography/geo.schemas";

function geo(overrides: Partial<GeoEvidence>): GeoEvidence {
  return { countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "unknown", evidenceType: "unknown", rawLocation: null, ...overrides };
}

/** Seeds Stage 2G evidence AND matching conversation/source-item rows carrying explicit geo metadata, keyed by the same deterministic ids seedEvidence already produced. */
function seedGeo(clustering: InMemoryDemandClusteringRepository, intelligence: InMemoryIntelligenceRepository, seed: Parameters<typeof seedEvidence>[1], location: GeoEvidence): DemandClusteringEvidence {
  const evidence = seedEvidence(clustering, seed);
  const conversation = evidence.conversation!;
  const sourceItem = evidence.sourceItem!;
  intelligence.sourceItems.set(sourceItem.id, {
    id: sourceItem.id, evidence_node_id: sourceItem.evidence_node_id, source_key: sourceItem.source_key, external_id: sourceItem.id,
    external_conversation_id: null, canonical_url: null, author_external_id: null, author_display_name: null, author_profile_url: null,
    title: null, body: "Representative excerpt.", published_at: sourceItem.published_at, captured_at: sourceItem.published_at ?? now.toISOString(),
    language: null, metadata: { geo: location }, content_hash: sourceItem.content_hash ?? "hash", latest_raw_source_item_id: sourceItem.id,
    normalization_version: "v1", status: "normalized", created_at: now.toISOString(), updated_at: now.toISOString(),
  } as unknown as SourceItemRow);
  intelligence.conversations.set(conversation.id, {
    id: conversation.id, evidence_node_id: conversation.evidence_node_id, conversation_key: conversation.id, primary_source_item_id: sourceItem.id,
    canonical_url: null, author_external_id: null, author_display_name: null, author_profile_url: null, title: null, body: "Representative excerpt.",
    published_at: conversation.published_at, last_activity_at: conversation.last_activity_at, captured_at: conversation.published_at ?? now.toISOString(),
    language: null, metadata: {}, content_hash: "hash", canonicalization_version: "v1", created_at: now.toISOString(), updated_at: now.toISOString(),
  } as unknown as ConversationRow);
  return evidence;
}

function setup() {
  const clustering = new InMemoryDemandClusteringRepository();
  const intelligence = new InMemoryIntelligenceRepository();
  const clusteringService = new DemandClusteringService(clustering);
  const service = new CurrentGeographyService(clustering, intelligence);
  const cluster = (productId = productA, workspaceId = workspaceA, at = now) => clusteringService.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  return { clustering, intelligence, service, cluster };
}

describe("Layer 9D CurrentGeographyService — currentness", () => {
  it("superseded, invalidated, retracted, and stale evidence all contribute zero to current geography", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "current", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "superseded", concepts: ["pricing"], current: false }, geo({ countryCode: "GB", countryName: "United Kingdom", confidence: "high", evidenceType: "provider_country" }));
    const invalidated = seedGeo(clustering, intelligence, { key: "invalidated", concepts: ["pricing"] }, geo({ countryCode: "DE", countryName: "Germany", confidence: "high", evidenceType: "provider_country" }));
    invalidated.signal!.lifecycle_status = "invalidated";
    const retracted = seedGeo(clustering, intelligence, { key: "retracted", concepts: ["pricing"] }, geo({ countryCode: "FR", countryName: "France", confidence: "high", evidenceType: "provider_country" }));
    retracted.signal!.lifecycle_status = "retracted";
    seedGeo(clustering, intelligence, { key: "stale", concepts: ["pricing"], publishedAt: "2026-05-01T00:00:00.000Z" }, geo({ countryCode: "NL", countryName: "Netherlands", confidence: "high", evidenceType: "provider_country" }));
    await cluster();

    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    expect(result.currentEvidenceCount).toBe(1);
    expect(result.countries).toEqual([expect.objectContaining({ countryCode: "US", currentEvidenceCount: 1 })]);
  });
});

describe("Layer 9D CurrentGeographyService — product-wide dedupe (Guardrail 1)", () => {
  it("counts a conversation contributing to two current concepts once, product-wide", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    // One conversation evidencing BOTH pricing and api_access: two memberships, same conversation_id.
    // Two separately-qualified evaluations (distinct matchKey) sharing one conversation_id —
    // this is how one conversation legitimately evidences two concepts at once.
    const shared = seedGeo(clustering, intelligence, { key: "shared-pricing", conversationKey: "shared", matchKey: "shared-pricing-match", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "shared-api", conversationKey: "shared", matchKey: "shared-api-match", concepts: ["api_access"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "only-pricing", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    await cluster();

    const productWide = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    // 2 distinct conversations total (shared + only-pricing), never 3 (which would double-count "shared").
    expect(productWide.currentEvidenceCount).toBe(2);

    const pricing = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "pricing", now });
    const apiAccess = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "api_access", now });
    // The shared conversation legitimately appears in BOTH concept-scoped views.
    expect(pricing.currentEvidenceCount).toBe(2);
    expect(apiAccess.currentEvidenceCount).toBe(1);
    expect(apiAccess.countries[0]?.representativeSignals[0]?.conversationId).toBe(shared.conversation!.id);
  });

  it("never sums concept-level totals to derive the product-wide total", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "shared-pricing", conversationKey: "shared", matchKey: "shared-pricing-match", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "shared-api", conversationKey: "shared", matchKey: "shared-api-match", concepts: ["api_access"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    await cluster();
    const productWide = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    const pricing = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "pricing", now });
    const apiAccess = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "api_access", now });
    expect(pricing.currentEvidenceCount + apiAccess.currentEvidenceCount).toBe(2);
    expect(productWide.currentEvidenceCount).toBe(1);
    expect(productWide.currentEvidenceCount).not.toBe(pricing.currentEvidenceCount + apiAccess.currentEvidenceCount);
  });
});

describe("Layer 9D concept roll-up", () => {
  it("rolls multiple clusters sharing one anchor concept into one geography view, while unrelated concepts stay separate", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "p1", concepts: ["pricing"], intent: "switching_intent", target: "unknown" }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "p2", concepts: ["pricing"], intent: "alternative_search", target: "category" }, geo({ countryCode: "GB", countryName: "United Kingdom", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "api1", concepts: ["api_access"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    await cluster();

    const pricing = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "pricing", now });
    expect(pricing.currentEvidenceCount).toBe(2);
    expect(pricing.countries.map((c) => c.countryCode).sort()).toEqual(["GB", "US"]);

    const apiAccess = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "api_access", now });
    expect(apiAccess.currentEvidenceCount).toBe(1);
  });
});

describe("Layer 9D location semantics", () => {
  it("counts reliable explicit country, gates region on the existing 5-signal minimum, excludes language_only, and retains unknown", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    for (let index = 0; index < 4; index += 1) seedGeo(clustering, intelligence, { key: `region-${index}`, concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "country-only", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "lang-only", concepts: ["pricing"] }, geo({ confidence: "low", evidenceType: "language_only" }));
    seedGeo(clustering, intelligence, { key: "unknown", concepts: ["pricing"] }, geo({ confidence: "unknown", evidenceType: "unknown" }));
    await cluster();

    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    expect(result.currentEvidenceCount).toBe(7);
    expect(result.knownLocationCount).toBe(5); // 4 region + 1 country-only; language_only and unknown excluded from "known"
    expect(result.unknownLocationCount).toBe(2);
    const us = result.countries.find((c) => c.countryCode === "US")!;
    expect(us.currentEvidenceCount).toBe(5);
    // Below the 5-signal region gate: regions stays empty even though 4 of the 5 US signals share one region.
    expect(us.regions).toEqual([]);
  });

  it("counts a region once it reaches the existing 5-signal minimum", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    for (let index = 0; index < 5; index += 1) seedGeo(clustering, intelligence, { key: `region-${index}`, concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California", confidence: "high", evidenceType: "provider_country" }));
    await cluster();
    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    const us = result.countries.find((c) => c.countryCode === "US")!;
    expect(us.regions).toEqual([{ regionCode: "US-CA", regionName: "California", currentEvidenceCount: 5 }]);
  });

  it("never treats source/provider as geography", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "gh", concepts: ["pricing"], source: "github" }, geo({ confidence: "unknown", evidenceType: "unknown" }));
    seedGeo(clustering, intelligence, { key: "bs", concepts: ["pricing"], source: "bluesky" }, geo({ confidence: "unknown", evidenceType: "unknown" }));
    await cluster();
    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    // Two different providers, zero explicit geo metadata: both unknown, no country inferred from source_key.
    expect(result.countries).toEqual([]);
    expect(result.unknownLocationCount).toBe(2);
  });
});

describe("Layer 9D percentages", () => {
  it("computes percentage of all current evidence and percentage of known-location evidence correctly, never dropping unknown from the all-evidence denominator", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    for (let index = 0; index < 7; index += 1) seedGeo(clustering, intelligence, { key: `us-${index}`, concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    for (let index = 0; index < 4; index += 1) seedGeo(clustering, intelligence, { key: `gb-${index}`, concepts: ["pricing"] }, geo({ countryCode: "GB", countryName: "United Kingdom", confidence: "high", evidenceType: "provider_country" }));
    for (let index = 0; index < 2; index += 1) seedGeo(clustering, intelligence, { key: `nl-${index}`, concepts: ["pricing"] }, geo({ countryCode: "NL", countryName: "Netherlands", confidence: "high", evidenceType: "provider_country" }));
    for (let index = 0; index < 7; index += 1) seedGeo(clustering, intelligence, { key: `unk-${index}`, concepts: ["pricing"] }, geo({ confidence: "unknown", evidenceType: "unknown" }));
    await cluster();

    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    expect(result.currentEvidenceCount).toBe(20);
    expect(result.knownLocationCount).toBe(13);
    expect(result.unknownLocationCount).toBe(7);
    const us = result.countries.find((c) => c.countryCode === "US")!;
    expect(us.percentageOfAllCurrentEvidence).toBe(35); // 7/20
    expect(us.percentageOfKnownLocationEvidence).toBeCloseTo(53.8, 1); // 7/13
  });
});

describe("Layer 9D zero-current-demand honesty", () => {
  it("Linear-shaped case (evidence all superseded/invalidated): honest empty current Geography", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    for (let index = 0; index < 10; index += 1) seedGeo(clustering, intelligence, { key: `superseded-${index}`, concepts: ["jira"], current: false }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    const invalidated = seedGeo(clustering, intelligence, { key: "invalidated", concepts: ["jira"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    invalidated.signal!.lifecycle_status = "invalidated";
    await cluster();

    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    expect(result.currentEvidenceCount).toBe(0);
    expect(result.countries).toEqual([]);
    const headline = currentGeographyHeadline(result);
    expect(headline.state).toBe("no_current_demand");
    expect(headline.title).toBe("No current geographic demand confirmed");
  });
});

describe("Layer 9D — no trend in the current model (Guardrail 2)", () => {
  it("the v2 read model carries no trend/rising/cooling field at all", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "a", concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    await cluster();
    const result = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, now });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/trend|rising|cooling|growing|percentageChange|growthRate/i);
  });
});

describe("Layer 9D tenancy", () => {
  it("isolates current geography by workspace/product; concept filter cannot escape product scope", async () => {
    const { clustering, intelligence, service, cluster } = setup();
    seedGeo(clustering, intelligence, { key: "a", productId: productA, concepts: ["pricing"] }, geo({ countryCode: "US", countryName: "United States", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "a2", productId: productA2, concepts: ["pricing"] }, geo({ countryCode: "GB", countryName: "United Kingdom", confidence: "high", evidenceType: "provider_country" }));
    seedGeo(clustering, intelligence, { key: "b", workspaceId: workspaceB, productId: productB, concepts: ["pricing"] }, geo({ countryCode: "NL", countryName: "Netherlands", confidence: "high", evidenceType: "provider_country" }));
    await cluster(productA); await cluster(productA2); await cluster(productB, workspaceB);

    const forA = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA, anchorConceptKey: "pricing", now });
    const forA2 = await service.getCurrentGeography({ workspaceId: workspaceA, productId: productA2, anchorConceptKey: "pricing", now });
    const forB = await service.getCurrentGeography({ workspaceId: workspaceB, productId: productB, anchorConceptKey: "pricing", now });
    expect(forA.countries.map((c) => c.countryCode)).toEqual(["US"]);
    expect(forA2.countries.map((c) => c.countryCode)).toEqual(["GB"]);
    expect(forB.countries.map((c) => c.countryCode)).toEqual(["NL"]);
  });
});

describe("Layer 9D policy — pure dedupe helpers", () => {
  it("productWideCurrentMembers and conceptScopedCurrentMembers both dedupe by conversation_id", () => {
    const memberA = { membershipId: "m1", clusterId: "c1", matchEvaluationId: "e1", productMatchId: "pm1", conversationId: "conv-1", sourceKey: "github", evidenceAt: "2026-09-20T00:00:00.000Z", evidenceNodeId: "n1", contributes: true, reason: null, pendingRecompute: false };
    const memberADuplicate = { ...memberA, membershipId: "m2", clusterId: "c2" };
    const concept = { conceptKey: "pricing", identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "pricing" }, label: "Pricing", status: "current" as const, activeEvidenceCount: 1, activeSourceCount: 1, sourceMix: {}, intentFamilyMix: {}, targetScopeMix: {}, level: "single" as const, firstActiveEvidenceAt: null, lastActiveEvidenceAt: null, observedEvidenceCount: 1, lastObservedAt: null, exclusions: {}, updatePending: false, stateComputedAt: null, buyerLanguage: [], clusters: [{ clusterId: "c1", clusterKey: "k1", label: "l", intentFamily: "switch" as const, targetScope: "product" as const, evidenceNodeId: "n", activeEvidenceCount: 1, persistedState: null, members: [memberA] }, { clusterId: "c2", clusterKey: "k2", label: "l2", intentFamily: "evaluate" as const, targetScope: "market" as const, evidenceNodeId: "n2", activeEvidenceCount: 1, persistedState: null, members: [memberADuplicate] }] };
    expect(productWideCurrentMembers([concept])).toHaveLength(1);
    expect(conceptScopedCurrentMembers(concept)).toHaveLength(1);
  });

  it("buildCurrentGeography never reports fake city precision", () => {
    const members: CurrentGeographyMember[] = [{ member: { membershipId: "m1", clusterId: "c1", matchEvaluationId: "e1", productMatchId: "pm1", conversationId: "conv-1", sourceKey: "github", evidenceAt: "2026-09-20T00:00:00.000Z", evidenceNodeId: "n1", contributes: true, reason: null, pendingRecompute: false }, excerpt: "x", location: { countryCode: "US", countryName: "United States", regionCode: null, regionName: null, city: "San Francisco", confidence: "high", evidenceType: "provider_country" } }];
    const result = buildCurrentGeography({ members, clusteringVersion: "demand_clustering_v1", generatedAt: now, anchorConceptKey: null, diagnostics: { clustersRead: 1, membershipsRead: 1, statesRead: 0, statesTruncated: false } });
    expect(JSON.stringify(result)).not.toMatch(/San Francisco|city/i);
  });
});
