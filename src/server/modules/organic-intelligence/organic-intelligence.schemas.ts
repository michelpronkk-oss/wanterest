import { z } from "zod";

export const organicPageFamilies = [
  "marketing_landing",
  "access_conversion",
  "public_market_intelligence",
  "demand_opportunity",
  "company_competitor_intelligence",
  "trend_demand_drift",
  "geography_intelligence",
  "research_data_report",
  "public_identity_share",
] as const;

export const organicIntelligenceFamilies = [
  "public_market_intelligence",
  "demand_opportunity",
  "company_competitor_intelligence",
  "trend_demand_drift",
  "geography_intelligence",
  "research_data_report",
] as const;

export const organicPageFamilySchema = z.enum(organicPageFamilies);
export const organicIntelligenceFamilySchema = z.enum(organicIntelligenceFamilies);
export type OrganicIntelligenceFamily = z.infer<typeof organicIntelligenceFamilySchema>;

export const evidenceMaturityStates = [
  "observed",
  "repeated",
  "corroborated",
  "persistent",
  "accelerating",
  "market_level",
] as const;

export const evidenceMaturitySchema = z.enum(evidenceMaturityStates);
export type EvidenceMaturity = z.infer<typeof evidenceMaturitySchema>;

export const readinessDecisionStates = [
  "eligible",
  "eligible_review_required",
  "insufficient_evidence",
  "insufficient_diversity",
  "insufficient_persistence",
  "stale",
  "truth_unconfirmed",
  "high_concentration",
  "privacy_blocked",
  "copyright_blocked",
  "duplicate_identity",
  "merged_identity",
  "uniqueness_unverified",
  "freshness_unverified",
  "safety_unverified",
  "evidence_unavailable",
  "noindex",
] as const;

export const readinessDecisionStateSchema = z.enum(readinessDecisionStates);
export type ReadinessDecisionState = z.infer<typeof readinessDecisionStateSchema>;

export const gateStateSchema = z.enum(["pass", "fail", "review", "unavailable"]);
export type GateState = z.infer<typeof gateStateSchema>;

export const independenceMetricsSchema = z.object({
  // This is an upstream, validated independent-episode measure; raw mention volume is not accepted here.
  independentEpisodeCount: z.number().int().nonnegative().nullable(),
  uniqueAuthorCount: z.number().int().nonnegative().nullable(),
  sourceFamilyCount: z.number().int().nonnegative().nullable(),
  timeBucketCount: z.number().int().nonnegative().nullable(),
  firstObservedAt: z.iso.datetime().nullable(),
  lastObservedAt: z.iso.datetime().nullable(),
  duplicateRatio: z.number().min(0).max(1).nullable(),
  sourceConcentration: z.number().min(0).max(1).nullable(),
  viralEventConcentration: z.number().min(0).max(1).nullable(),
  // Calculated from independent episodes per time bucket, never raw mentions.
  independentEpisodeAcceleration: z.number().nullable(),
  geographyConfidence: z.number().min(0).max(1).nullable(),
  regionalIndependentEpisodeCount: z.number().int().nonnegative().nullable(),
});

export type IndependenceMetrics = z.infer<typeof independenceMetricsSchema>;

export const freshnessClaimKinds = [
  "demand_signal",
  "supply_fact",
  "trend_measurement",
  "geography_sample",
  "research_dataset",
] as const;

export const claimTruthStates = ["confirmed", "needs_review", "unconfirmed"] as const;

export const freshnessClaimSchema = z.object({
  kind: z.enum(freshnessClaimKinds),
  lastMeaningfulUpdateAt: z.iso.datetime().nullable(),
  truth: z.enum(claimTruthStates),
}).strict();

export const researchReadinessSchema = z.object({
  topicManuallyApproved: z.boolean().nullable(),
  datasetDefensible: z.boolean().nullable(),
  datasetRecordCount: z.number().int().nonnegative().nullable(),
  methodologyDefined: z.boolean().nullable(),
}).strict();

export const uniquenessStateSchema = z.enum(["unique", "duplicate", "merged", "unverified", "review"]);
export const privacyStateSchema = z.enum(["approved", "blocked", "unverified"]);
export const copyrightStateSchema = z.enum(["aggregate_approved", "paraphrase_approved", "excerpt_approved", "blocked", "unverified"]);

export const organicReadinessCandidateSchema = z.object({
  objectId: z.string().uuid(),
  family: organicIntelligenceFamilySchema,
  canonicalSubjectKey: z.string().trim().min(1).max(240),
  independence: independenceMetricsSchema,
  freshnessClaims: z.array(freshnessClaimSchema).max(10),
  uniqueness: uniquenessStateSchema,
  privacy: privacyStateSchema,
  copyright: copyrightStateSchema,
  research: researchReadinessSchema.nullable(),
  firstPartySupplyConfirmed: z.boolean().nullable(),
  indexPolicy: z.enum(["candidate", "noindex"]),
  publicEvidenceRefs: z.array(z.string().trim().min(1).max(120)).max(200),
}).strict();

export type OrganicReadinessCandidate = z.infer<typeof organicReadinessCandidateSchema>;

export const readinessReasonSchema = z.object({
  code: z.string().min(1).max(80),
  axis: z.enum(["evidence", "diversity", "persistence", "freshness", "uniqueness", "truth", "concentration", "safety", "indexing"]),
  detail: z.string().min(1).max(320),
  evidenceRefs: z.array(z.string().min(1).max(120)).max(40),
}).strict();

export const gateAssessmentSchema = z.object({
  state: gateStateSchema,
  reasons: z.array(readinessReasonSchema),
}).strict();
export type GateAssessment = z.infer<typeof gateAssessmentSchema>;

export const eligibilityDecisionSchema = z.object({
  objectId: z.string().uuid(),
  family: organicIntelligenceFamilySchema,
  state: readinessDecisionStateSchema,
  maturity: evidenceMaturitySchema.nullable(),
  evaluatedAt: z.iso.datetime(),
  gates: z.object({
    evidence: gateAssessmentSchema,
    diversity: gateAssessmentSchema,
    persistence: gateAssessmentSchema,
    freshness: gateAssessmentSchema,
    uniqueness: gateAssessmentSchema,
    truth: gateAssessmentSchema,
    concentration: gateAssessmentSchema,
    safety: gateAssessmentSchema,
  }).strict(),
  reasons: z.array(readinessReasonSchema),
}).strict();

export type EligibilityDecision = z.infer<typeof eligibilityDecisionSchema>;

const safeEvidenceSummarySchema = z.object({
  text: z.string().trim().min(1).max(280),
  mode: z.enum(["paraphrase", "approved_excerpt"]),
  sourceFamily: z.string().trim().min(1).max(80),
  sourceUrl: z.string().url().nullable(),
  observedAt: z.iso.datetime(),
  privacyReviewedAt: z.iso.datetime(),
  copyrightReviewedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.mode === "approved_excerpt" && value.text.length > 160) {
    context.addIssue({ code: "custom", message: "Approved excerpts are limited to 160 characters." });
  }
  if (value.sourceUrl) {
    const url = new URL(value.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      context.addIssue({ code: "custom", message: "Source attribution must be an HTTPS URL without credentials, query parameters, or fragments." });
    }
  }
});

export const publicSafeIntelligenceProjectionSchema = z.object({
  publicId: z.string().regex(/^[a-f0-9]{64}$/),
  family: organicIntelligenceFamilySchema,
  subject: z.string().trim().min(1).max(160),
  claimState: z.enum(["supported", "limited", "under_review"]),
  maturity: evidenceMaturitySchema.nullable(),
  confidence: z.enum(["low", "moderate", "high"]),
  evidence: z.object({
    supportingRecordCount: z.number().int().nonnegative(),
    independentEpisodeCount: z.number().int().nonnegative().nullable(),
    sourceFamilies: z.array(z.string().trim().min(1).max(80)).max(20),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    geographyConfidence: z.number().min(0).max(1).nullable(),
    summaries: z.array(safeEvidenceSummarySchema).max(12),
  }).strict(),
  relationship: z.object({
    demandState: z.enum(["present", "limited", "unavailable"]),
    supplyState: z.enum(["confirmed", "limited", "not_assessed"]),
    movement: z.enum(["rising", "cooling", "stable", "not_assessed"]),
  }).strict(),
  methodology: z.object({
    independentEpisodeDefinition: z.string().trim().min(20).max(500),
    limitations: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
    sourceFamilies: z.array(z.string().trim().min(1).max(80)).max(20),
    timeWindowStart: z.iso.datetime(),
    timeWindowEnd: z.iso.datetime(),
  }).strict(),
  meaningfulUpdatedAt: z.iso.datetime(),
  eligibility: z.object({
    state: readinessDecisionStateSchema,
    reasons: z.array(z.object({
      code: z.string().min(1).max(80),
      axis: z.enum(["evidence", "diversity", "persistence", "freshness", "uniqueness", "truth", "concentration", "safety", "indexing"]),
    }).strict()).max(40),
  }).strict(),
  canonicalPath: z.string().regex(/^\/(market|demand|companies|trends|markets|research)\/[a-z0-9~/-]+$/),
}).strict().superRefine((projection, context) => {
  const routeShapes: Record<OrganicIntelligenceFamily, RegExp> = {
    public_market_intelligence: /^\/market\/[a-z0-9-]+~[a-f0-9]{64}$/,
    demand_opportunity: /^\/demand\/[a-z0-9-]+~[a-f0-9]{64}\/[a-z0-9-]+~[a-f0-9]{64}$/,
    company_competitor_intelligence: /^\/companies\/[a-z0-9-]+~[a-f0-9]{64}$/,
    trend_demand_drift: /^\/trends\/[a-z0-9-]+~[a-f0-9]{64}$/,
    geography_intelligence: /^\/markets\/[a-z0-9-]+~[a-f0-9]{64}\/[a-z0-9-]+~[a-f0-9]{64}$/,
    research_data_report: /^\/research\/[a-z0-9-]+~[a-f0-9]{64}$/,
  };
  if (!routeShapes[projection.family].test(projection.canonicalPath)) {
    context.addIssue({ code: "custom", path: ["canonicalPath"], message: "canonical_path_family_mismatch" });
  }
});

export type PublicSafeIntelligenceProjection = z.infer<typeof publicSafeIntelligenceProjectionSchema>;
