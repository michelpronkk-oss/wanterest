import { describe, expect, it } from "vitest";

import {
  assessEvidenceMaturity,
  assessRefreshLifecycle,
  canonicalPathFor,
  createPublicSafeIntelligenceProjection,
  evaluateOrganicEligibility,
  FUTURE_CANONICAL_ROUTE_TEMPLATES,
  measureIndependentEpisodes,
  organicIntelligenceFamilies,
  organicPageFamilies,
  organicReadinessCandidateSchema,
  parsePublicSafeIntelligenceProjection,
  prioritizeEligibleCandidate,
  resolveCanonicalIdentity,
  transitionPublicationState,
  type CanonicalIdentityRecord,
  type EpisodeObservation,
  type OrganicReadinessCandidate,
  type PublicProjectionSource,
} from "../../src/server/modules/organic-intelligence";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function metrics(overrides: Partial<OrganicReadinessCandidate["independence"]> = {}): OrganicReadinessCandidate["independence"] {
  return {
    independentEpisodeCount: 28,
    uniqueAuthorCount: 21,
    sourceFamilyCount: 3,
    timeBucketCount: 6,
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-09-20T00:00:00.000Z",
    duplicateRatio: 0.08,
    sourceConcentration: 0.16,
    viralEventConcentration: 0.12,
    independentEpisodeAcceleration: 0.31,
    geographyConfidence: 0.91,
    regionalIndependentEpisodeCount: 37,
    ...overrides,
  };
}

function claim(kind: OrganicReadinessCandidate["freshnessClaims"][number]["kind"], overrides: Partial<OrganicReadinessCandidate["freshnessClaims"][number]> = {}) {
  return {
    kind,
    lastMeaningfulUpdateAt: "2026-09-20T00:00:00.000Z",
    truth: "confirmed" as const,
    ...overrides,
  };
}

function candidate(
  family: OrganicReadinessCandidate["family"] = "demand_opportunity",
  overrides: Partial<OrganicReadinessCandidate> = {},
): OrganicReadinessCandidate {
  const claims = family === "company_competitor_intelligence"
    ? [claim("demand_signal"), claim("supply_fact")]
    : family === "trend_demand_drift"
      ? [claim("trend_measurement")]
      : family === "geography_intelligence"
        ? [claim("demand_signal"), claim("geography_sample")]
        : family === "research_data_report"
          ? [claim("research_dataset")]
          : [claim("demand_signal")];
  return {
    objectId: CANDIDATE_ID,
    family,
    canonicalSubjectKey: "synthetic-workflow-demand",
    independence: metrics(),
    freshnessClaims: claims,
    uniqueness: "unique",
    privacy: "approved",
    copyright: "paraphrase_approved",
    research: family === "research_data_report"
      ? { topicManuallyApproved: true, datasetDefensible: true, datasetRecordCount: 72, methodologyDefined: true }
      : null,
    firstPartySupplyConfirmed: family === "company_competitor_intelligence" ? true : null,
    indexPolicy: "candidate",
    publicEvidenceRefs: ["synthetic-evidence:episode-group-a", "synthetic-evidence:source-family-b"],
    ...overrides,
  };
}

function projectionSource(sourceCandidate = candidate()): PublicProjectionSource {
  const eligibility = evaluateOrganicEligibility(sourceCandidate, NOW);
  return {
    candidate: sourceCandidate,
    eligibility,
    subject: "Synthetic test subject",
    claimState: "supported",
    confidence: "high",
    supportingRecordCount: 34,
    sourceFamilies: ["synthetic-community", "synthetic-forum", "synthetic-review"],
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-09-20T00:00:00.000Z",
    summaries: [{
      text: "Synthetic paraphrase for contract testing only.",
      mode: "paraphrase",
      sourceFamily: "synthetic-community",
      sourceUrl: "https://community.invalid/discussion?id=private-token#quote",
      observedAt: "2026-09-20T00:00:00.000Z",
      privacyReviewedAt: "2026-09-21T00:00:00.000Z",
      copyrightReviewedAt: "2026-09-21T00:00:00.000Z",
    }],
    relationship: { demandState: "present", supplyState: "limited", movement: "rising" },
    methodology: {
      independentEpisodeDefinition: "Synthetic independent episode groups used only to exercise the test contract.",
      limitations: ["Synthetic fixtures are not market measurements."],
      sourceFamilies: ["synthetic-community", "synthetic-forum"],
      timeWindowStart: "2026-01-01T00:00:00.000Z",
      timeWindowEnd: "2026-09-20T00:00:00.000Z",
    },
    meaningfulUpdatedAt: "2026-09-20T00:00:00.000Z",
    canonicalPath: `/demand/workflows~${"a".repeat(64)}/workflow-gap~${"b".repeat(64)}`,
  };
}

describe("organic intelligence families and maturity", () => {
  it("keeps exactly the nine approved template families and evaluates only families 3–8", () => {
    expect(organicPageFamilies).toHaveLength(9);
    expect(organicIntelligenceFamilies).toEqual([
      "public_market_intelligence",
      "demand_opportunity",
      "company_competitor_intelligence",
      "trend_demand_drift",
      "geography_intelligence",
      "research_data_report",
    ]);
    expect(FUTURE_CANONICAL_ROUTE_TEMPLATES).toEqual({
      public_market_intelligence: "/market/[market]",
      demand_opportunity: "/demand/[market]/[demand]",
      company_competitor_intelligence: "/companies/[company]",
      trend_demand_drift: "/trends/[trend]",
      geography_intelligence: "/markets/[region]/[market]",
      research_data_report: "/research/[report]",
    });
  });

  it("uses independent episodes rather than raw mention volume and leaves missing dimensions unavailable", () => {
    const missing = metrics({ independentEpisodeCount: null });
    expect(assessEvidenceMaturity(missing).state).toBe("unavailable");
    expect(organicReadinessCandidateSchema.safeParse({
      ...candidate(),
      rawMentionCount: 15000,
      viralThreadCount: 1,
    }).success).toBe(false);
  });

  it("does not label high-volume concentrated or viral evidence market-level", () => {
    const result = assessEvidenceMaturity(metrics({
      independentEpisodeCount: 320,
      uniqueAuthorCount: 18,
      sourceFamilyCount: 3,
      sourceConcentration: 0.72,
      viralEventConcentration: 0.78,
    }));
    expect(result.state).not.toBe("market_level");
  });

  it("marks repeated evidence separately from cross-source corroboration and persistence", () => {
    expect(assessEvidenceMaturity(metrics({
      independentEpisodeCount: 4,
      uniqueAuthorCount: 4,
      sourceFamilyCount: 1,
      timeBucketCount: 1,
    })).state).toBe("repeated");
    expect(assessEvidenceMaturity(metrics({
      independentEpisodeCount: 6,
      uniqueAuthorCount: 5,
      sourceFamilyCount: 2,
      timeBucketCount: 2,
    })).state).toBe("corroborated");
  });

  it("does not call a declining episode series accelerating", () => {
    const declining = assessEvidenceMaturity(metrics({
      independentEpisodeCount: 18,
      uniqueAuthorCount: 12,
      sourceFamilyCount: 3,
      timeBucketCount: 5,
      firstObservedAt: "2026-01-01T00:00:00.000Z",
      lastObservedAt: "2026-09-20T00:00:00.000Z",
      independentEpisodeAcceleration: -0.6,
    }));
    expect(declining.state).not.toBe("accelerating");
  });
});

describe("independent episode measurement", () => {
  function episode(overrides: Partial<EpisodeObservation> = {}): EpisodeObservation {
    const observedAt = "2026-01-15T12:00:00.000Z";
    return {
      episodeKey: "episode-a",
      authorKey: "author-a",
      sourceFamily: "community-a",
      timeBucket: observedAt.slice(0, 7),
      observedAt,
      duplicate: false,
      viralEventKey: null,
      regionKey: null,
      geographyConfidence: null,
      ...overrides,
    };
  }

  it("deduplicates explicit duplicate observations and reports the raw duplicate ratio", () => {
    const result = measureIndependentEpisodes([
      episode(),
      episode({ episodeKey: "duplicate-copy", duplicate: true }),
    ]);
    expect(result.state).toBe("available");
    expect(result.metrics.independentEpisodeCount).toBe(1);
    expect(result.rawObservationCount).toBe(2);
    expect(result.duplicateObservationCount).toBe(1);
    expect(result.metrics.duplicateRatio).toBe(0.5);
  });

  it("collapses cross-platform viral coverage to one episode and one independent author", () => {
    const result = measureIndependentEpisodes([
      episode({ episodeKey: "post-a", viralEventKey: "viral-1", authorKey: "author-a", sourceFamily: "forum" }),
      episode({ episodeKey: "post-b", viralEventKey: "viral-1", authorKey: "author-b", sourceFamily: "social", observedAt: "2026-01-16T12:00:00.000Z" }),
      episode({ episodeKey: "post-c", viralEventKey: "viral-1", authorKey: "author-c", sourceFamily: "news", observedAt: "2026-01-17T12:00:00.000Z" }),
      episode({ episodeKey: "independent", authorKey: "author-d", sourceFamily: "review" }),
    ]);
    expect(result.metrics.independentEpisodeCount).toBe(2);
    expect(result.metrics.uniqueAuthorCount).toBe(2);
    expect(result.metrics.sourceFamilyCount).toBe(2);
    expect(result.metrics.sourceConcentration).toBe(0.5);
    expect(result.metrics.viralEventConcentration).toBe(0.75);
  });

  it("keeps viral concentration visible to the eligibility policy", () => {
    const observations = [
      ...Array.from({ length: 8 }, (_, index) => episode({
        episodeKey: `viral-copy-${index}`,
        authorKey: `author-${index}`,
        sourceFamily: index % 2 === 0 ? "forum" : "social",
        viralEventKey: "one-viral-event",
      })),
      episode({ episodeKey: "other-1", authorKey: "other-author-1", sourceFamily: "reviews", viralEventKey: null }),
      episode({ episodeKey: "other-2", authorKey: "other-author-2", sourceFamily: "support", viralEventKey: null }),
    ];
    const measured = measureIndependentEpisodes(observations);
    expect(measured.metrics.independentEpisodeCount).toBe(3);
    expect(measured.metrics.viralEventConcentration).toBe(0.8);
    const decision = evaluateOrganicEligibility(candidate("demand_opportunity", {
      independence: measured.metrics,
    }), NOW);
    expect(decision.state).toBe("high_concentration");
    expect(assessEvidenceMaturity(measured.metrics).state).not.toBe("market_level");
  });

  it("returns unavailable metrics when any usable record lacks canonical author identity", () => {
    const result = measureIndependentEpisodes([
      episode(),
      episode({ episodeKey: "unknown-author", authorKey: null }),
    ]);
    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("author_identity_unavailable");
    expect(result.metrics.independentEpisodeCount).toBeNull();
  });

  it("rejects raw text fields and time buckets that disagree with observation timestamps", () => {
    expect(() => measureIndependentEpisodes([
      { ...episode(), body: "private source text" } as unknown as EpisodeObservation,
    ])).toThrow("episode_observation_invalid");
    expect(() => measureIndependentEpisodes([
      episode({ timeBucket: "2025-12" }),
    ])).toThrow("episode_observation_invalid");
  });

  it("calculates acceleration from continuous monthly independent episode buckets", () => {
    const rows = [
      episode({ episodeKey: "jan-a", observedAt: "2026-01-02T00:00:00.000Z", timeBucket: "2026-01" }),
      episode({ episodeKey: "feb-a", observedAt: "2026-02-02T00:00:00.000Z", timeBucket: "2026-02" }),
      ...[1, 2, 3].map((n) => episode({ episodeKey: `mar-${n}`, observedAt: `2026-03-0${n}T00:00:00.000Z`, timeBucket: "2026-03" })),
      ...[1, 2, 3].map((n) => episode({ episodeKey: `apr-${n}`, observedAt: `2026-04-0${n}T00:00:00.000Z`, timeBucket: "2026-04" })),
      episode({ episodeKey: "viral-echo", duplicate: true, viralEventKey: "old-event" }),
    ];
    const result = measureIndependentEpisodes(rows);
    expect(result.metrics.independentEpisodeCount).toBe(8);
    expect(result.metrics.independentEpisodeAcceleration).toBe(2);
  });

  it("derives regional count and confidence from independent episodes only", () => {
    const result = measureIndependentEpisodes([
      episode({ episodeKey: "regional-a", regionKey: "region-a", geographyConfidence: 0.95 }),
      episode({ episodeKey: "regional-b", regionKey: "region-b", geographyConfidence: 0.84 }),
      episode({ episodeKey: "viral-a", viralEventKey: "same-event", regionKey: "region-a", geographyConfidence: 0.99 }),
      episode({ episodeKey: "viral-b", viralEventKey: "same-event", regionKey: "region-b", geographyConfidence: 0.99 }),
    ]);
    expect(result.metrics.independentEpisodeCount).toBe(3);
    expect(result.metrics.regionalIndependentEpisodeCount).toBe(2);
    expect(result.metrics.geographyConfidence).toBe(1);
  });
});

describe("family-specific publication eligibility", () => {
  it("requires a persistent, cross-source demand opportunity", () => {
    const valid = evaluateOrganicEligibility(candidate(), NOW);
    expect(valid.state).toBe("eligible");
    expect(valid.maturity).toBe("market_level");

    const concentrated = evaluateOrganicEligibility(candidate("demand_opportunity", {
      independence: metrics({ independentEpisodeCount: 80, sourceConcentration: 0.68, viralEventConcentration: 0.61 }),
    }), NOW);
    expect(concentrated.state).toBe("high_concentration");
    expect(concentrated.gates.concentration.state).toBe("fail");
  });

  it("requires first-party-confirmed company supply facts and independent external demand", () => {
    const missingSupply = evaluateOrganicEligibility(candidate("company_competitor_intelligence", {
      firstPartySupplyConfirmed: false,
    }), NOW);
    expect(missingSupply.state).toBe("truth_unconfirmed");
    expect(missingSupply.reasons.map((item) => item.code)).toContain("first_party_supply_unconfirmed");

    const lowDiversity = evaluateOrganicEligibility(candidate("company_competitor_intelligence", {
      independence: metrics({ uniqueAuthorCount: 2, sourceFamilyCount: 1 }),
    }), NOW);
    expect(lowDiversity.state).toBe("insufficient_diversity");
  });

  it("requires meaningful independent movement and historical time buckets for trends", () => {
    const noMovement = evaluateOrganicEligibility(candidate("trend_demand_drift", {
      independence: metrics({ independentEpisodeAcceleration: 0.02 }),
    }), NOW);
    expect(noMovement.state).toBe("insufficient_persistence");
    expect(noMovement.reasons.map((item) => item.code)).toContain("independent_movement_not_significant");

    const unavailableMovement = evaluateOrganicEligibility(candidate("trend_demand_drift", {
      independence: metrics({ independentEpisodeAcceleration: null }),
    }), NOW);
    expect(unavailableMovement.state).toBe("insufficient_persistence");
  });

  it("withholds geography rankings without location confidence and an adequate regional sample", () => {
    const smallRegion = evaluateOrganicEligibility(candidate("geography_intelligence", {
      independence: metrics({ geographyConfidence: 0.62, regionalIndependentEpisodeCount: 12 }),
    }), NOW);
    expect(smallRegion.state).toBe("insufficient_evidence");
    expect(smallRegion.reasons.map((item) => item.code)).toContain("geography_sample_insufficient");
  });

  it("requires human topic approval, a defensible dataset, and explicit methodology for reports", () => {
    const unreviewed = evaluateOrganicEligibility(candidate("research_data_report", {
      research: { topicManuallyApproved: false, datasetDefensible: false, datasetRecordCount: 72, methodologyDefined: false },
    }), NOW);
    expect(unreviewed.state).toBe("insufficient_evidence");
    expect(unreviewed.reasons.map((item) => item.code)).toContain("research_methodology_incomplete");

    const tooSmall = evaluateOrganicEligibility(candidate("research_data_report", {
      research: { topicManuallyApproved: true, datasetDefensible: true, datasetRecordCount: 11, methodologyDefined: true },
    }), NOW);
    expect(tooSmall.state).toBe("insufficient_evidence");
  });

  it("uses claim-specific freshness and never refreshes a claim from the evaluation timestamp", () => {
    const staleSupply = evaluateOrganicEligibility(candidate("company_competitor_intelligence", {
      freshnessClaims: [
        claim("demand_signal"),
        claim("supply_fact", { lastMeaningfulUpdateAt: "2026-08-29T00:00:00.000Z" }),
      ],
    }), NOW);
    expect(staleSupply.state).toBe("stale");
    expect(staleSupply.reasons.map((item) => item.code)).toContain("claim_stale_supply_fact");

    const missingFreshness = evaluateOrganicEligibility(candidate("demand_opportunity", {
      freshnessClaims: [],
    }), NOW);
    expect(missingFreshness.state).toBe("freshness_unverified");
  });

  it("blocks duplicate and merged identities with machine-readable reasons", () => {
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { uniqueness: "duplicate" }), NOW).state).toBe("duplicate_identity");
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { uniqueness: "merged" }), NOW).state).toBe("merged_identity");
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { uniqueness: "unverified" }), NOW).state).toBe("uniqueness_unverified");
  });

  it("blocks privacy, copyright, explicit noindex, and unconfirmed public claims", () => {
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { privacy: "blocked" }), NOW).state).toBe("privacy_blocked");
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { copyright: "blocked" }), NOW).state).toBe("copyright_blocked");
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", { indexPolicy: "noindex" }), NOW).state).toBe("noindex");
    expect(evaluateOrganicEligibility(candidate("demand_opportunity", {
      freshnessClaims: [claim("demand_signal", { truth: "unconfirmed" })],
    }), NOW).state).toBe("truth_unconfirmed");
  });

  it("retains all failed gate reasons with safe evidence references", () => {
    const result = evaluateOrganicEligibility(candidate("demand_opportunity", {
      independence: metrics({ independentEpisodeCount: 2, uniqueAuthorCount: 1, sourceFamilyCount: 1, sourceConcentration: 0.9 }),
      publicEvidenceRefs: ["synthetic-evidence:one"],
    }), NOW);
    expect(result.state).toBe("high_concentration");
    expect(result.reasons.map((item) => item.axis)).toEqual(expect.arrayContaining(["evidence", "diversity", "concentration"]));
    expect(result.reasons.every((item) => item.evidenceRefs.every((ref) => ref.startsWith("synthetic-evidence:")))).toBe(true);
  });
});

describe("public-safe projection", () => {
  it("projects reviewed allowlisted fields and strips source URL query strings and fragments", () => {
    const projection = createPublicSafeIntelligenceProjection(projectionSource());
    expect(projection.publicId).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.evidence.summaries[0]?.sourceUrl).toBe("https://community.invalid/discussion?id=private-token#quote".split("?")[0]);
    expect(JSON.stringify(projection)).not.toContain("private-token");
    expect(JSON.stringify(projection)).not.toContain(CANDIDATE_ID);
  });

  it("rejects private payloads and workspace state rather than silently copying them", () => {
    const projection = createPublicSafeIntelligenceProjection(projectionSource());
    expect(parsePublicSafeIntelligenceProjection({ ...projection, rawProviderPayload: { body: "private" } })).toBeNull();
    expect(parsePublicSafeIntelligenceProjection({ ...projection, workspaceId: "33333333-3333-4333-8333-333333333333" })).toBeNull();
    expect(parsePublicSafeIntelligenceProjection({ ...projection, privateContactState: "saved" })).toBeNull();
    expect(parsePublicSafeIntelligenceProjection({
      ...projection,
      evidence: { ...projection.evidence, summaries: [{ ...projection.evidence.summaries[0]!, sourceUrl: "https://community.invalid/discussion?token=secret" }] },
    })).toBeNull();
    expect(parsePublicSafeIntelligenceProjection({ ...projection, canonicalPath: "/research/not-a-research-identity" })).toBeNull();
  });

  it("requires privacy and copyright review before building a public-safe projection", () => {
    expect(() => createPublicSafeIntelligenceProjection(projectionSource(candidate("demand_opportunity", { privacy: "unverified" })))).toThrow("public_projection_review_required");
    expect(() => createPublicSafeIntelligenceProjection(projectionSource(candidate("demand_opportunity", { copyright: "unverified" })))).toThrow("public_projection_review_required");
  });

  it("rejects long approved excerpts and source URLs containing credentials", () => {
    const longExcerpt = projectionSource();
    longExcerpt.summaries = [{ ...longExcerpt.summaries[0]!, mode: "approved_excerpt", text: "x".repeat(161) }];
    expect(() => createPublicSafeIntelligenceProjection(longExcerpt)).toThrow("public_projection_contract_invalid");

    const credentialUrl = projectionSource();
    credentialUrl.summaries = [{ ...credentialUrl.summaries[0]!, sourceUrl: "https://user:secret@community.invalid/post" }];
    expect(() => createPublicSafeIntelligenceProjection(credentialUrl)).toThrow("public_projection_source_url_invalid");
  });

  it("does not project blocked or mismatched candidates", () => {
    const blocked = projectionSource(candidate("demand_opportunity", { uniqueness: "duplicate" }));
    expect(() => createPublicSafeIntelligenceProjection(blocked)).toThrow("public_projection_candidate_ineligible");

    const mismatch = projectionSource();
    mismatch.eligibility.objectId = TARGET_ID;
    expect(() => createPublicSafeIntelligenceProjection(mismatch)).toThrow("public_projection_identity_mismatch");
  });

  it("keeps episode maturity unavailable for a research report whose proof is a reviewed dataset", () => {
    const source = projectionSource(candidate("research_data_report", {
      independence: metrics({ independentEpisodeCount: null }),
    }));
    source.canonicalPath = `/research/original-report~${"c".repeat(64)}`;
    const projection = createPublicSafeIntelligenceProjection(source);
    expect(projection.maturity).toBeNull();
    expect(projection.evidence.independentEpisodeCount).toBeNull();
  });
});

describe("canonical identity and merge handling", () => {
  const input = {
    family: "demand_opportunity" as const,
    objectId: CANDIDATE_ID,
    market: { key: "workflow software", objectId: TARGET_ID },
    demand: { key: "follow-up gap", objectId: CANDIDATE_ID },
    aliasKeys: ["follow-up-automation"],
  };

  it("creates a deterministic safe route identity from canonical keys, not display titles", () => {
    const first = canonicalPathFor(input);
    expect(first).toMatch(/^\/demand\/[a-z0-9~-]+\/[a-z0-9~-]+$/);
    expect(canonicalPathFor(input)).toBe(first);
    expect(first).not.toContain(CANDIDATE_ID);
  });

  it("refuses path or alias collisions instead of creating duplicate public identities", () => {
    const proposed = canonicalPathFor(input);
    const pathCollision: CanonicalIdentityRecord[] = [{ family: input.family, objectId: TARGET_ID, path: proposed, aliasKeys: [] }];
    expect(resolveCanonicalIdentity(input, pathCollision).state).toBe("collision");
    const aliasCollision: CanonicalIdentityRecord[] = [{ family: input.family, objectId: TARGET_ID, path: "/demand/other/identity", aliasKeys: ["follow-up-automation"] }];
    expect(resolveCanonicalIdentity(input, aliasCollision).state).toBe("duplicate");
  });

  it("uses a stronger canonical identity for merged objects and returns a redirect seam", () => {
    const target: CanonicalIdentityRecord = { family: input.family, objectId: TARGET_ID, path: "/demand/workflows~canonical/workflow-gap~target", aliasKeys: [] };
    const merged = resolveCanonicalIdentity({ ...input, mergedIntoObjectId: TARGET_ID }, [target]);
    expect(merged.state).toBe("merged");
    expect(merged.canonicalPath).toBe(target.path);
    expect(merged.redirectFrom).toBeTruthy();
    expect(resolveCanonicalIdentity({ ...input, mergedIntoObjectId: "44444444-4444-4444-8444-444444444444" }, []).state).toBe("unresolved");
    const previouslyStored = { ...target, objectId: CANDIDATE_ID };
    expect(resolveCanonicalIdentity({ ...input, mergedIntoObjectId: TARGET_ID }, [previouslyStored, target]).state).toBe("merged");
  });
});

describe("Search Console ordering and publication lifecycle", () => {
  it("uses settled or provisional non-branded opportunities only to prioritize already-eligible review", () => {
    const eligible = evaluateOrganicEligibility(candidate(), NOW);
    const blocked = evaluateOrganicEligibility(candidate("demand_opportunity", { privacy: "blocked" }), NOW);
    expect(prioritizeEligibleCandidate(eligible, { state: "settled", opportunities: [{ type: "rising_query", branded: false }] })).toBe("search_opportunity");
    expect(prioritizeEligibleCandidate(eligible, { state: "provisional", opportunities: [{ type: "near_page_one", branded: false }] })).toBe("provisional_signal");
    expect(prioritizeEligibleCandidate(eligible, { state: "settled", opportunities: [{ type: "rising_query", branded: true }] })).toBe("standard_review");
    expect(prioritizeEligibleCandidate(blocked, { state: "settled", opportunities: [{ type: "rising_query", branded: false }] })).toBe("not_eligible");
    expect(prioritizeEligibleCandidate(eligible, { state: "unavailable", opportunities: [] })).toBe("unavailable");
  });

  it("never auto-approves or auto-publishes, and requires a human audit record", () => {
    const eligible = evaluateOrganicEligibility(candidate(), NOW);
    const automaticApproval = transitionPublicationState("review_required", "approve", eligible, { kind: "system" });
    const missingAudit = transitionPublicationState("review_required", "approve", eligible, { kind: "human", userId: CANDIDATE_ID, reason: "Reviewed" });
    expect(automaticApproval.allowed).toBe(false);
    expect(missingAudit.allowed).toBe(false);
    expect(transitionPublicationState("candidate", "evaluate", eligible, { kind: "system" }).state).toBe("eligible");
    expect(transitionPublicationState("approved", "publish", eligible, {
      kind: "human", userId: CANDIDATE_ID, auditEventId: "audit-event-1", reason: "Human approval",
    }).state).toBe("published");
  });

  it("sends stale published claims to review before noindex or retirement", () => {
    const stale = evaluateOrganicEligibility(candidate("demand_opportunity", {
      freshnessClaims: [claim("demand_signal", { lastMeaningfulUpdateAt: "2025-01-01T00:00:00.000Z" })],
    }), NOW);
    expect(assessRefreshLifecycle(stale, "2025-01-01T00:00:00.000Z").state).toBe("review_due");
    expect(transitionPublicationState("published", "stale_review", stale, { kind: "system" }).state).toBe("review_required");
    expect(transitionPublicationState("published", "noindex", stale, { kind: "system" }).allowed).toBe(false);
    const eligible = evaluateOrganicEligibility(candidate(), NOW);
    expect(assessRefreshLifecycle(eligible, "not-a-date").state).toBe("unavailable");
    expect(transitionPublicationState("noindex", "evaluate", eligible, { kind: "system" }).state).toBe("noindex");
    expect(transitionPublicationState("retired", "evaluate", eligible, { kind: "system" }).state).toBe("retired");
  });
});
