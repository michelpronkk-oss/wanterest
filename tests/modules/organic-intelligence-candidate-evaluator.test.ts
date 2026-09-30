import { describe, expect, it } from "vitest";
import { resolveCanonicalIdentity } from "../../src/server/modules/organic-intelligence/organic-intelligence.identity";
import { evaluateReviewedPublicCandidate, type PublicCandidateEvidenceRow } from "../../src/server/modules/organic-intelligence/public-candidate-evaluator";
import { SOURCE_FAMILY_BY_PROVIDER, type PublicSourcePolicy } from "../../src/server/modules/organic-intelligence/public-source-policy";

const topicId = "11111111-1111-4111-8111-111111111111";
const reviewerId = "22222222-2222-4222-8222-222222222222";
const policyDataUse = {
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

function policy(providerKey: string): PublicSourcePolicy {
  return {
    providerKey,
    familyKey: SOURCE_FAMILY_BY_PROVIDER[providerKey]!,
    sourceKind: "third_party",
    policyState: "approved",
    contextScope: "context_independent_public",
    reuseState: "aggregate_only",
    allowedProjectionFields: ["aggregate_counts"],
    approvedHostnames: [],
    policyVersion: 1,
    reviewedByUserId: reviewerId,
    reviewedAt: "2026-01-01T00:00:00.000Z",
    reviewReference: "reviewed-rights-basis",
    dataUse: policyDataUse,
  };
}

function candidateEvidence(): PublicCandidateEvidenceRow[] {
  const providers = ["hacker-news", "bluesky", "github", "youtube"];
  const months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-02"];
  return Array.from({ length: 8 }, (_, index) => {
    const providerKey = providers[index % providers.length]!;
    const observedAt = `${months[Math.floor(index / 2)]}T12:00:00.000Z`;
    const episodeFingerprint = (index + 1).toString(16).padStart(64, "0");
    const authorFingerprint = ((index % 6) + 33).toString(16).padStart(64, "0");
    const viralEventFingerprint = providerKey === "youtube" ? (index + 100).toString(16).padStart(64, "0") : null;
    const family = SOURCE_FAMILY_BY_PROVIDER[providerKey]!;
    const provenanceRef = `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-${(index + 1).toString(16).padStart(12, "0")}`;
    return {
      providerKey,
      policy: policy(providerKey),
      topic: { topicId, state: "approved", namespace: "global_public", intelligenceFamily: "demand_opportunity" },
      evidenceScope: "context_independent_public",
      identity: {
        episodeFingerprint, authorFingerprint, publishedAt: observedAt, observedAt,
        identityVerified: true, duplicate: false, duplicateVerified: false,
        viralEventFingerprint, viralEventVerified: viralEventFingerprint !== null,
        policyVersion: 1, identityKeyVersion: "hmac-v1",
        regionKey: null, geographyReviewed: false, geographyConfidence: null,
      },
      observation: {
        episodeKey: episodeFingerprint, authorKey: authorFingerprint, sourceFamily: family,
        timeBucket: observedAt.slice(0, 7), observedAt, duplicate: false,
        viralEventKey: viralEventFingerprint, regionKey: null, geographyConfidence: null,
      },
      provenanceRef,
    };
  });
}

function evaluate(overrides: Partial<Parameters<typeof evaluateReviewedPublicCandidate>[0]> = {}) {
  const identity = resolveCanonicalIdentity({
    family: "demand_opportunity",
    market: { key: "workflow software", objectId: "market-1" },
    demand: { key: "approval workflow", objectId: topicId },
    objectId: topicId,
  }, []);
  return evaluateReviewedPublicCandidate({
    objectId: topicId,
    family: "demand_opportunity",
    canonicalSubjectKey: "global:approval-workflow",
    topic: { topicId, state: "approved", namespace: "global_public", intelligenceFamily: "demand_opportunity" },
    topicSafetyReview: {
      topicId,
      privacyState: "approved",
      copyrightState: "paraphrase_approved",
      reviewedByUserId: reviewerId,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewReference: "topic-safety-review",
    },
    canonicalIdentity: identity,
    evidence: candidateEvidence(),
    freshnessClaims: [{ kind: "demand_signal", lastMeaningfulUpdateAt: "2026-04-01T00:00:00.000Z", truth: "confirmed" }],
    firstPartySupplyConfirmed: null,
    searchConsole: { state: "settled", opportunities: [{ type: "high_impressions_low_ctr", branded: false }] },
    evaluatedAt: new Date("2026-05-10T00:00:00.000Z"),
    ...overrides,
  });
}

describe("reviewed public candidate → existing SEO-2 engine", () => {
  it("measures reviewed public evidence and preserves normalized provenance through eligibility", () => {
    const result = evaluate();
    expect(result.eligibility.state).toBe("eligible");
    expect(result.candidate.independence).toMatchObject({
      independentEpisodeCount: 8,
      uniqueAuthorCount: 6,
      sourceFamilyCount: 4,
      timeBucketCount: 4,
      sourceConcentration: 0.25,
    });
    expect(result.searchConsolePriority).toBe("search_opportunity");
    expect(result.candidate.publicEvidenceRefs).toHaveLength(8);
    expect(result.provenance).toHaveLength(8);
    expect(result.blockerCodes).toEqual([]);
  });

  it("never lets Search Console turn blocked evidence into eligible evidence", () => {
    const evidence = candidateEvidence().map((row) => ({ ...row, policy: { ...row.policy!, policyState: "unknown" as const } }));
    const result = evaluate({ evidence });
    expect(result.eligibility.state).not.toBe("eligible");
    expect(result.searchConsolePriority).toBe("not_eligible");
    expect(result.sourcePolicyBlockers.source_policy_not_approved).toBe(8);
  });

  it("fails closed when the attributable topic safety review is missing or belongs to another topic", () => {
    const missing = evaluate({ topicSafetyReview: {
      topicId,
      privacyState: "approved",
      copyrightState: "paraphrase_approved",
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReference: null,
    } });
    expect(missing.eligibility.state).not.toBe("eligible");
    expect(missing.blockerCodes).toContain("topic_safety_review_missing");

    const mismatched = evaluate({ topicSafetyReview: {
      topicId: "33333333-3333-4333-8333-333333333333",
      privacyState: "approved",
      copyrightState: "paraphrase_approved",
      reviewedByUserId: reviewerId,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewReference: "reviewed-another-topic",
    } });
    expect(mismatched.eligibility.state).not.toBe("eligible");
    expect(mismatched.blockerCodes).toContain("topic_safety_review_missing");
  });

  it("rejects workspace topics and candidate identity mismatches before evaluation", () => {
    expect(() => evaluate({ topic: { topicId, state: "approved", namespace: "workspace", intelligenceFamily: "demand_opportunity" } }))
      .toThrow("organic_public_candidate_topic_not_approved");
    expect(() => evaluate({ family: "public_market_intelligence" }))
      .toThrow("organic_public_candidate_identity_mismatch");
  });
});
