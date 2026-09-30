import {
  evaluateOrganicEligibility,
  prioritizeEligibleCandidate,
  type SearchConsoleReadinessSignal,
} from "./organic-intelligence.policy";
import type {
  CanonicalIdentityResult,
} from "./organic-intelligence.identity";
import {
  evaluatePublicEvidencePolicy,
  SOURCE_FAMILY_BY_PROVIDER,
  type PublicEvidenceIdentity,
  type PublicSourcePolicy,
  type PublicTopicSafetyReview,
  type PublicTopicIdentity,
} from "./public-source-policy";
import { measureIndependentEpisodes, type EpisodeObservation } from "./independent-episodes";
import type {
  OrganicReadinessCandidate,
} from "./organic-intelligence.schemas";

export type PublicCandidateEvidenceRow = {
  providerKey: string;
  policy: PublicSourcePolicy | null;
  topic: PublicTopicIdentity | null;
  evidenceScope: PublicSourcePolicy["contextScope"];
  identity: PublicEvidenceIdentity;
  observation: EpisodeObservation;
  provenanceRef: string;
};

/**
 * Maps only already reviewed global evidence into SEO-2. It never reads source
 * text, infers topics, or mutates the existing eligibility thresholds.
 */
export function evaluateReviewedPublicCandidate(input: {
  objectId: string;
  family: OrganicReadinessCandidate["family"];
  canonicalSubjectKey: string;
  topic: PublicTopicIdentity;
  topicSafetyReview: PublicTopicSafetyReview;
  canonicalIdentity: CanonicalIdentityResult;
  evidence: readonly PublicCandidateEvidenceRow[];
  freshnessClaims: OrganicReadinessCandidate["freshnessClaims"];
  firstPartySupplyConfirmed: boolean | null;
  searchConsole: SearchConsoleReadinessSignal;
  evaluatedAt?: Date;
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  if (input.topic.topicId !== input.objectId || input.topic.namespace !== "global_public" || input.topic.state !== "approved") {
    throw new Error("organic_public_candidate_topic_not_approved");
  }
  if (input.topic.intelligenceFamily !== input.family || input.canonicalIdentity.family !== input.family ||
      input.canonicalIdentity.objectId !== input.objectId) {
    throw new Error("organic_public_candidate_identity_mismatch");
  }

  const accepted: Array<{ row: PublicCandidateEvidenceRow; observation: EpisodeObservation }> = [];
  const policyBlockers = new Map<string, number>();
  const safetyReviewIsAttributable = input.topicSafetyReview.topicId === input.objectId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.topicSafetyReview.reviewedByUserId ?? "") &&
    input.topicSafetyReview.reviewedAt !== null && Number.isFinite(Date.parse(input.topicSafetyReview.reviewedAt)) &&
    Boolean(input.topicSafetyReview.reviewReference?.trim());
  const topicPrivacy = safetyReviewIsAttributable ? input.topicSafetyReview.privacyState : "unverified";
  const topicCopyright = safetyReviewIsAttributable ? input.topicSafetyReview.copyrightState : "unverified";
  if (!safetyReviewIsAttributable) policyBlockers.set("topic_safety_review_missing", 1);
  for (const row of input.evidence) {
    const decision = evaluatePublicEvidencePolicy({
      providerKey: row.providerKey,
      policy: row.policy,
      topic: row.topic,
      evidenceScope: row.evidenceScope,
      identity: row.identity,
    });
    const mappedFamily = SOURCE_FAMILY_BY_PROVIDER[row.providerKey];
    const observationIdentityMatches = row.observation.episodeKey === row.identity.episodeFingerprint &&
      row.observation.authorKey === row.identity.authorFingerprint &&
      row.observation.duplicate === row.identity.duplicate &&
      row.observation.viralEventKey === row.identity.viralEventFingerprint;
    const provenanceIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.provenanceRef);
    const reasons = [...decision.reasons];
    if (row.topic?.topicId !== input.objectId || row.topic?.intelligenceFamily !== input.family) reasons.push("topic_provenance_mismatch");
    if (!mappedFamily || row.observation.sourceFamily !== mappedFamily) reasons.push("source_family_mismatch");
    if (!observationIdentityMatches) reasons.push("episode_identity_mapping_mismatch");
    if (!provenanceIsUuid) reasons.push("provenance_reference_invalid");
    if (reasons.length > 0) {
      for (const reason of new Set(reasons)) policyBlockers.set(reason, (policyBlockers.get(reason) ?? 0) + 1);
      continue;
    }
    accepted.push({
      row,
      observation: { ...row.observation, sourceFamily: mappedFamily },
    });
  }

  const measurement = measureIndependentEpisodes(accepted.map((item) => item.observation));
  const uniqueness: OrganicReadinessCandidate["uniqueness"] =
    input.canonicalIdentity.state === "duplicate" ? "duplicate"
      : input.canonicalIdentity.state === "merged" ? "merged"
        : input.canonicalIdentity.state === "canonical" || input.canonicalIdentity.state === "existing" ? "unique"
          : input.canonicalIdentity.state === "collision" ? "review" : "unverified";
  const candidate: OrganicReadinessCandidate = {
    objectId: input.objectId,
    family: input.family,
    canonicalSubjectKey: input.canonicalSubjectKey,
    independence: measurement.metrics,
    freshnessClaims: input.freshnessClaims,
    uniqueness,
    privacy: topicPrivacy,
    copyright: topicCopyright,
    research: null,
    firstPartySupplyConfirmed: input.firstPartySupplyConfirmed,
    indexPolicy: input.canonicalIdentity.canonicalPath ? "candidate" : "noindex",
    publicEvidenceRefs: accepted.slice(0, 200).map((item) => item.row.provenanceRef),
  };
  const eligibility = evaluateOrganicEligibility(candidate, evaluatedAt);
  const searchConsolePriority = prioritizeEligibleCandidate(eligibility, input.searchConsole);
  const contributionRows = accepted.map(({ row, observation }) => ({
    episodeId: row.provenanceRef,
    contributionRole: observation.duplicate ? "duplicate" as const
      : observation.viralEventKey ? "viral_context" as const : "independent_support" as const,
  }));
  const engineBlockers = eligibility.reasons.map((item) => item.code);
  const blockerCodes = [...new Set([...engineBlockers, ...policyBlockers.keys()])].sort();
  const initialReviewState = eligibility.state === "eligible" ? "eligible" as const : "candidate" as const;

  return {
    candidate,
    eligibility,
    measurement,
    searchConsolePriority,
    canonicalPath: input.canonicalIdentity.canonicalPath,
    initialReviewState,
    blockerCodes,
    sourcePolicyBlockers: Object.fromEntries([...policyBlockers.entries()].sort(([a], [b]) => a.localeCompare(b))),
    provenance: contributionRows,
  };
}
