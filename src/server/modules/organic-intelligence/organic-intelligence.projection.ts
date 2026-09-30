import { createHash } from "node:crypto";

import {
  publicSafeIntelligenceProjectionSchema,
  type EligibilityDecision,
  type OrganicReadinessCandidate,
  type PublicSafeIntelligenceProjection,
} from "./organic-intelligence.schemas";

export type PublicProjectionSource = {
  candidate: OrganicReadinessCandidate;
  eligibility: EligibilityDecision;
  subject: string;
  claimState: PublicSafeIntelligenceProjection["claimState"];
  confidence: PublicSafeIntelligenceProjection["confidence"];
  supportingRecordCount: number;
  sourceFamilies: string[];
  windowStart: string;
  windowEnd: string;
  summaries: PublicSafeIntelligenceProjection["evidence"]["summaries"];
  relationship: PublicSafeIntelligenceProjection["relationship"];
  methodology: PublicSafeIntelligenceProjection["methodology"];
  meaningfulUpdatedAt: string;
  canonicalPath: string;
};

function publicIdFor(objectId: string): string {
  return createHash("sha256").update(`wanterest:organic-intelligence:v1:${objectId}`).digest("hex");
}

function sanitizeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("public_projection_source_url_invalid");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function createPublicSafeIntelligenceProjection(source: PublicProjectionSource): PublicSafeIntelligenceProjection {
  if (source.candidate.privacy !== "approved" || !["paraphrase_approved", "excerpt_approved"].includes(source.candidate.copyright)) {
    throw new Error("public_projection_review_required");
  }
  if (source.eligibility.objectId !== source.candidate.objectId || source.eligibility.family !== source.candidate.family) {
    throw new Error("public_projection_identity_mismatch");
  }
  if (source.eligibility.state !== "eligible" && source.eligibility.state !== "eligible_review_required") {
    throw new Error("public_projection_candidate_ineligible");
  }
  if (source.summaries.length > 0 && source.summaries.some((item) => !item.privacyReviewedAt || !item.copyrightReviewedAt)) {
    throw new Error("public_projection_evidence_review_required");
  }

  const sanitizedSummaries = source.summaries.map((item) => ({
    ...item,
    sourceUrl: sanitizeSourceUrl(item.sourceUrl),
  }));
  const projection = {
    publicId: publicIdFor(source.candidate.objectId),
    family: source.candidate.family,
    subject: source.subject,
    claimState: source.claimState,
    maturity: source.eligibility.maturity,
    confidence: source.confidence,
    evidence: {
      supportingRecordCount: source.supportingRecordCount,
      independentEpisodeCount: source.candidate.independence.independentEpisodeCount,
      sourceFamilies: source.sourceFamilies,
      windowStart: source.windowStart,
      windowEnd: source.windowEnd,
      geographyConfidence: source.candidate.independence.geographyConfidence,
      summaries: sanitizedSummaries,
    },
    relationship: source.relationship,
    methodology: source.methodology,
    meaningfulUpdatedAt: source.meaningfulUpdatedAt,
    eligibility: {
      state: source.eligibility.state,
      reasons: source.eligibility.reasons.map(({ code, axis }) => ({ code, axis })),
    },
    canonicalPath: source.canonicalPath,
  };

  const parsed = publicSafeIntelligenceProjectionSchema.safeParse(projection);
  if (!parsed.success) throw new Error("public_projection_contract_invalid");
  return parsed.data;
}

export function parsePublicSafeIntelligenceProjection(input: unknown): PublicSafeIntelligenceProjection | null {
  const parsed = publicSafeIntelligenceProjectionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
