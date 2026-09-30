import { describe, expect, it } from "vitest";

import {
  exactDuplicateKey,
  evaluatePublicEvidencePolicy,
  PUBLIC_SOURCE_FAMILY_CONTROLS,
  PUBLIC_SOURCE_FAMILIES,
  sanitizePublicSourceUrl,
  SOURCE_FAMILY_BY_PROVIDER,
} from "../../src/server/modules/organic-intelligence/public-source-policy";

const hash = "a".repeat(64);
const closedDataUse = {
  rawConversationContent: "internal_aggregate" as const,
  authorIdentity: "internal_aggregate" as const,
  canonicalUrl: "internal_aggregate" as const,
  providerIds: "blocked" as const,
  timestamps: "internal_aggregate" as const,
  evidenceExcerpts: "blocked" as const,
  derivedTopics: "internal_aggregate" as const,
  geography: "blocked" as const,
  companyEntityReferences: "blocked" as const,
  privateConnectors: "blocked" as const,
  workspaceInterpretation: "blocked" as const,
};

function input(overrides: Partial<Parameters<typeof evaluatePublicEvidencePolicy>[0]> = {}): Parameters<typeof evaluatePublicEvidencePolicy>[0] {
  return {
    providerKey: "hacker-news",
    policy: {
      providerKey: "hacker-news",
      familyKey: "community_discussion",
      sourceKind: "third_party" as const,
      policyState: "approved" as const,
      contextScope: "context_independent_public" as const,
      reuseState: "aggregate_only" as const,
      allowedProjectionFields: ["aggregate_counts"],
      approvedHostnames: ["news.ycombinator.com"],
      policyVersion: 1,
      reviewedByUserId: "11111111-1111-4111-8111-111111111111",
      reviewedAt: "2026-08-11T12:00:00.000Z",
      reviewReference: "rights-review-2026-08",
      dataUse: closedDataUse,
    },
    topic: { topicId: "11111111-1111-4111-8111-111111111111", state: "approved" as const, namespace: "global_public" as const, intelligenceFamily: "public_market_intelligence" },
    evidenceScope: "context_independent_public" as const,
    identity: {
      episodeFingerprint: hash,
      authorFingerprint: "b".repeat(64),
      publishedAt: "2026-08-12T12:00:00.000Z",
      observedAt: "2026-08-12T13:00:00.000Z",
      identityVerified: true,
      duplicate: false,
      duplicateVerified: false,
      viralEventFingerprint: null,
      viralEventVerified: false,
      policyVersion: 1,
      identityKeyVersion: "hmac-v1",
      regionKey: null,
      geographyReviewed: false,
      geographyConfidence: null,
    },
    ...overrides,
  } as Parameters<typeof evaluatePublicEvidencePolicy>[0];
}

describe("public intelligence source policy", () => {
  it("groups providers into source families rather than counting provider names", () => {
    expect(new Set(Object.values(SOURCE_FAMILY_BY_PROVIDER)).size).toBe(4);
    expect(SOURCE_FAMILY_BY_PROVIDER["hacker-news"]).toBe(SOURCE_FAMILY_BY_PROVIDER["stack-exchange"]);
    expect(SOURCE_FAMILY_BY_PROVIDER.bluesky).toBe(SOURCE_FAMILY_BY_PROVIDER.x);
    expect(SOURCE_FAMILY_BY_PROVIDER.youtube).toBe("video_comments");
    expect(Object.keys(PUBLIC_SOURCE_FAMILIES)).toHaveLength(7);
    expect(PUBLIC_SOURCE_FAMILY_CONTROLS.video_comments.eventCollapseRequired).toBe(true);
    expect(PUBLIC_SOURCE_FAMILY_CONTROLS.first_party_company.demandRole).toBe("first_party_supply_only");
  });

  it("allows measurement only when source rights, independent context, topic and identities are approved", () => {
    expect(evaluatePublicEvidencePolicy(input())).toMatchObject({ state: "eligible_for_measurement", publicProjectionAllowed: true, reasons: [] });
  });

  it("allows reviewed aggregate-only sources to measure internally without source-level public projection", () => {
    const result = evaluatePublicEvidencePolicy(input({ policy: {
      ...input().policy!, policyState: "restricted", reuseState: "aggregate_only",
      allowedProjectionFields: ["aggregate_counts", "topic_identity"],
    } }));
    expect(result).toMatchObject({ state: "eligible_for_measurement", publicProjectionAllowed: false, reasons: [] });
  });

  it("does not allow projection-restricted sources to publish an attribution or excerpt", () => {
    const result = evaluatePublicEvidencePolicy(input({ policy: {
      ...input().policy!, policyState: "restricted", reuseState: "aggregate_only",
      allowedProjectionFields: ["aggregate_counts", "source_attribution"],
    } }));
    expect(result.reasons).toContain("projection_restricted_source_has_exposure_fields");
    expect(result.publicProjectionAllowed).toBe(false);
  });

  it.each([
    ["unmapped provider", input({ providerKey: "private-connector" }), "provider_family_unknown"],
    ["missing policy", input({ policy: null }), "source_policy_missing"],
    ["unknown policy", input({ policy: { ...input().policy!, policyState: "unknown" } }), "source_policy_not_approved"],
    ["workspace interpretation", input({ evidenceScope: "workspace_selected_public" }), "evidence_scope_not_public_independent"],
    ["tenant private evidence", input({ evidenceScope: "tenant_private" }), "evidence_scope_not_public_independent"],
    ["workspace topic", input({ topic: { ...input().topic!, namespace: "workspace" } }), "workspace_topic_forbidden"],
    ["unapproved topic", input({ topic: { ...input().topic!, state: "proposed" } }), "public_topic_not_approved"],
    ["invalid topic family", input({ topic: { ...input().topic!, intelligenceFamily: "workspace_signal" } }), "topic_intelligence_family_unavailable"],
    ["unknown field policy", input({ policy: { ...input().policy!, dataUse: { ...closedDataUse, geography: "unknown" } } }), "source_field_policy_unknown"],
    ["author display policy", input({ policy: { ...input().policy!, dataUse: { ...closedDataUse, authorIdentity: "public_attribution" } } }), "author_identity_public_projection_forbidden"],
    ["private connector", input({ policy: { ...input().policy!, dataUse: { ...closedDataUse, privateConnectors: "internal_aggregate" } } }), "private_connector_forbidden"],
    ["unverified episode", input({ identity: { ...input().identity, identityVerified: false } }), "episode_identity_unverified"],
    ["missing author", input({ identity: { ...input().identity, authorFingerprint: null } }), "author_identity_unavailable"],
    ["unverified duplicate relation", input({ identity: { ...input().identity, duplicate: true, duplicateVerified: false } }), "duplicate_relation_unverified"],
    ["policy version mismatch", input({ identity: { ...input().identity, policyVersion: 2 } }), "source_policy_version_mismatch"],
    ["missing policy review", input({ policy: { ...input().policy!, reviewedAt: null, reviewedByUserId: null } }), "source_policy_review_missing"],
    ["first-party supply source", input({ policy: { ...input().policy!, sourceKind: "first_party" } }), "non_third_party_source_not_independent_demand"],
  ])("blocks %s", (_name, record, reason) => {
    expect(evaluatePublicEvidencePolicy(record).reasons).toContain(reason);
  });

  it("requires video-comment evidence to resolve to a verified concentration event", () => {
    const result = evaluatePublicEvidencePolicy(input({ providerKey: "youtube" }));
    expect(result.state).toBe("blocked");
    expect(result.reasons).toContain("source_family_event_collapse_required");
  });

  it("strips recognized tracking and fragment data, then fails closed on sensitive or ambiguous URLs", () => {
    const hosts = ["news.ycombinator.com"];
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com/item?id=1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com/item/1#reply", hosts)).toBe("https://news.ycombinator.com/item/1");
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com/item/1?utm_source=mail&fbclid=abc#reply", hosts)).toBe("https://news.ycombinator.com/item/1");
    expect(sanitizePublicSourceUrl("https://user:secret@news.ycombinator.com/item/1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("http://news.ycombinator.com/item/1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com:8443/item/1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com/token/secret", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://evilnews.ycombinator.com/item/1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://sub.news.ycombinator.com/item/1", hosts)).toBeNull();
    expect(sanitizePublicSourceUrl("https://news.ycombinator.com/item/1", hosts)).toBe("https://news.ycombinator.com/item/1");
  });

  it("uses exact URL/content identities only and leaves semantic similarity unresolved", () => {
    expect(exactDuplicateKey({ canonicalUrlFingerprint: hash, exactContentFingerprint: null })).toBe(`url:${hash}`);
    expect(exactDuplicateKey({ canonicalUrlFingerprint: null, exactContentFingerprint: hash })).toBe(`content:${hash}`);
    expect(exactDuplicateKey({ canonicalUrlFingerprint: null, exactContentFingerprint: null })).toBeNull();
  });
});
