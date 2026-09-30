import { organicIntelligenceFamilies } from "./organic-intelligence.schemas";

export const PUBLIC_SOURCE_FAMILIES = {
  community_discussion: "Community discussion",
  developer_community: "Developer community",
  social_platform: "Social platform",
  video_comments: "Video comments",
  review_platform: "Review platform",
  editorial_reporting: "Editorial and reporting",
  first_party_company: "First-party company source",
} as const;

export type PublicSourceFamily = keyof typeof PUBLIC_SOURCE_FAMILIES;

export const SOURCE_FAMILY_BY_PROVIDER: Readonly<Record<string, PublicSourceFamily>> = {
  "hacker-news": "community_discussion",
  "stack-exchange": "community_discussion",
  reddit: "community_discussion",
  discourse: "community_discussion",
  github: "developer_community",
  gitlab: "developer_community",
  bluesky: "social_platform",
  x: "social_platform",
  youtube: "video_comments",
};

export const PUBLIC_SOURCE_FAMILY_CONTROLS: Readonly<Record<PublicSourceFamily, {
  demandRole: "third_party_demand" | "first_party_supply_only";
  eventCollapseRequired: boolean;
  duplicateBasis: "exact_or_reviewed_relation";
}>> = {
  community_discussion: { demandRole: "third_party_demand", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
  developer_community: { demandRole: "third_party_demand", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
  social_platform: { demandRole: "third_party_demand", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
  video_comments: { demandRole: "third_party_demand", eventCollapseRequired: true, duplicateBasis: "exact_or_reviewed_relation" },
  review_platform: { demandRole: "third_party_demand", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
  editorial_reporting: { demandRole: "third_party_demand", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
  first_party_company: { demandRole: "first_party_supply_only", eventCollapseRequired: false, duplicateBasis: "exact_or_reviewed_relation" },
};

export type PublicSourcePolicy = {
  providerKey: string;
  familyKey: string;
  sourceKind: "third_party" | "first_party" | "uncertain";
  policyState: "unknown" | "restricted" | "approved" | "blocked";
  contextScope: "unknown" | "context_independent_public" | "workspace_selected_public" | "tenant_private" | "first_party";
  reuseState: "unknown" | "aggregate_only" | "paraphrase_allowed" | "excerpt_allowed" | "blocked";
  allowedProjectionFields: readonly string[];
  approvedHostnames: readonly string[];
  policyVersion: number;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReference: string | null;
  dataUse: {
    rawConversationContent: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    authorIdentity: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    canonicalUrl: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    providerIds: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    timestamps: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    evidenceExcerpts: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    derivedTopics: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    geography: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    companyEntityReferences: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    privateConnectors: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
    workspaceInterpretation: "unknown" | "internal_aggregate" | "public_paraphrase" | "public_attribution" | "public_excerpt" | "blocked";
  };
};

export type PublicTopicIdentity = {
  topicId: string;
  state: "proposed" | "approved" | "rejected" | "merged";
  namespace: "global_public" | "workspace" | "product" | "unknown";
  intelligenceFamily: string;
};

export type PublicTopicSafetyReview = {
  topicId: string;
  privacyState: "approved" | "blocked" | "unverified";
  copyrightState: "aggregate_approved" | "paraphrase_approved" | "excerpt_approved" | "blocked" | "unverified";
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReference: string | null;
};

export type PublicEvidenceIdentity = {
  episodeFingerprint: string | null;
  authorFingerprint: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  identityVerified: boolean;
  duplicate: boolean;
  duplicateVerified: boolean;
  viralEventFingerprint: string | null;
  viralEventVerified: boolean;
  policyVersion: number;
  identityKeyVersion: string;
  regionKey: string | null;
  geographyReviewed: boolean;
  geographyConfidence: number | null;
};

export type PublicEvidenceDecision = {
  state: "eligible_for_measurement" | "blocked";
  familyKey: PublicSourceFamily | null;
  publicProjectionAllowed: boolean;
  reasons: string[];
};

const blockedProjectionFields = new Set([
  "provider_id",
  "author_display_name",
  "author_profile_url",
]);

function isFingerprint(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

/** Applies fail-closed provider, privacy, rights, topic, and identity gates. */
export function evaluatePublicEvidencePolicy(input: {
  providerKey: string;
  policy: PublicSourcePolicy | null;
  topic: PublicTopicIdentity | null;
  evidenceScope: PublicSourcePolicy["contextScope"];
  identity: PublicEvidenceIdentity;
}): PublicEvidenceDecision {
  const mappedFamily = SOURCE_FAMILY_BY_PROVIDER[input.providerKey];
  const reasons: string[] = [];

  if (!mappedFamily) reasons.push("provider_family_unknown");
  if (mappedFamily && PUBLIC_SOURCE_FAMILY_CONTROLS[mappedFamily].eventCollapseRequired && input.identity.viralEventFingerprint === null) {
    reasons.push("source_family_event_collapse_required");
  }
  if (!input.policy) reasons.push("source_policy_missing");
  if (input.policy && input.policy.providerKey !== input.providerKey) reasons.push("provider_policy_mismatch");
  if (input.policy?.sourceKind !== "third_party") reasons.push("non_third_party_source_not_independent_demand");
  if (input.policy && (!Number.isInteger(input.policy.policyVersion) || input.policy.policyVersion < 1 ||
    !input.policy.reviewedByUserId || !validTimestamp(input.policy.reviewedAt) || !input.policy.reviewReference?.trim())) {
    reasons.push("source_policy_review_missing");
  }
  if (input.policy && input.identity.policyVersion !== input.policy.policyVersion) reasons.push("source_policy_version_mismatch");
  if (input.policy && mappedFamily && input.policy.familyKey !== mappedFamily) reasons.push("source_family_mismatch");
  if (!input.policy || !["approved", "restricted"].includes(input.policy.policyState)) reasons.push("source_policy_not_approved");
  if (input.policy?.contextScope !== "context_independent_public") reasons.push("source_context_not_independent_public");
  if (!input.policy || !["aggregate_only", "paraphrase_allowed", "excerpt_allowed"].includes(input.policy.reuseState)) {
    reasons.push("source_reuse_not_approved");
  }
  if (!input.policy?.allowedProjectionFields.includes("aggregate_counts")) reasons.push("aggregate_projection_not_allowed");
  if (input.policy && Object.values(input.policy.dataUse).some((state) => state === "unknown")) reasons.push("source_field_policy_unknown");
  if (input.policy?.dataUse.rawConversationContent !== "internal_aggregate") reasons.push("raw_content_public_projection_forbidden");
  if (input.policy?.dataUse.authorIdentity !== "internal_aggregate" && input.policy?.dataUse.authorIdentity !== "blocked") {
    reasons.push("author_identity_public_projection_forbidden");
  }
  if (input.policy?.dataUse.providerIds !== "blocked") reasons.push("provider_ids_public_projection_forbidden");
  if (input.policy?.dataUse.privateConnectors !== "blocked") reasons.push("private_connector_forbidden");
  if (input.policy?.dataUse.workspaceInterpretation !== "blocked") reasons.push("workspace_interpretation_forbidden");
  if (input.policy?.policyState === "restricted" && (
    input.policy.reuseState !== "aggregate_only" ||
    input.policy.dataUse.canonicalUrl !== "internal_aggregate" && input.policy.dataUse.canonicalUrl !== "blocked" ||
    input.policy.dataUse.evidenceExcerpts !== "internal_aggregate" && input.policy.dataUse.evidenceExcerpts !== "blocked" ||
    input.policy.allowedProjectionFields.some((field) => !["aggregate_counts", "topic_identity"].includes(field))
  )) reasons.push("projection_restricted_source_has_exposure_fields");
  if (input.policy?.allowedProjectionFields.some((field) => blockedProjectionFields.has(field))) {
    reasons.push("direct_author_or_provider_identity_forbidden");
  }
  if (input.evidenceScope !== "context_independent_public") reasons.push("evidence_scope_not_public_independent");
  if (!input.topic) reasons.push("public_topic_missing");
  if (input.topic && input.topic.state !== "approved") reasons.push("public_topic_not_approved");
  if (input.topic && input.topic.namespace !== "global_public") reasons.push("workspace_topic_forbidden");
  if (input.topic && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.topic.topicId)) {
    reasons.push("global_topic_id_invalid");
  }
  if (input.topic && !organicIntelligenceFamilies.includes(input.topic.intelligenceFamily as (typeof organicIntelligenceFamilies)[number])) {
    reasons.push("topic_intelligence_family_unavailable");
  }
  if (!input.identity.identityVerified || !isFingerprint(input.identity.episodeFingerprint)) reasons.push("episode_identity_unverified");
  if (!isFingerprint(input.identity.authorFingerprint)) reasons.push("author_identity_unavailable");
  if (!validTimestamp(input.identity.publishedAt)) reasons.push("published_time_unavailable");
  if (!validTimestamp(input.identity.observedAt)) reasons.push("observed_time_unavailable");
  if (input.identity.duplicate && !input.identity.duplicateVerified) reasons.push("duplicate_relation_unverified");
  if (input.identity.viralEventFingerprint !== null && (!input.identity.viralEventVerified || !isFingerprint(input.identity.viralEventFingerprint))) {
    reasons.push("viral_event_identity_unverified");
  }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(input.identity.identityKeyVersion)) reasons.push("identity_key_version_unavailable");
  if (input.identity.regionKey && (!input.identity.geographyReviewed || input.identity.geographyConfidence === null)) {
    reasons.push("geography_not_reviewed");
  }

  return {
    state: reasons.length === 0 ? "eligible_for_measurement" : "blocked",
    familyKey: mappedFamily ?? null,
    publicProjectionAllowed: reasons.length === 0 && input.policy?.policyState === "approved",
    reasons: [...new Set(reasons)],
  };
}

/**
 * Source links are attribution only, never identity keys. Query/fragment-bearing
 * URLs are withheld because removing them could point at the wrong source item.
 */
export function sanitizePublicSourceUrl(value: string, approvedHostnames: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = approvedHostnames.some((approved) => {
    const domain = approved.toLowerCase().replace(/\.$/, "");
    return host === domain;
  });
  if (!allowed) return null;

  const trackingParameter = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src)$/i;
  const params = [...url.searchParams.keys()];
  if (params.some((key) => !trackingParameter.test(key))) return null;
  for (const key of params) url.searchParams.delete(key);
  url.hash = "";
  if (/(?:^|\/)(?:token|access|auth|session|reset|invite)(?:\/|$)/i.test(url.pathname)) return null;
  return url.toString();
}

/** Exact identities only. Semantic similarity must never collapse episodes. */
export function exactDuplicateKey(input: {
  canonicalUrlFingerprint: string | null;
  exactContentFingerprint: string | null;
}): string | null {
  if (isFingerprint(input.canonicalUrlFingerprint)) return `url:${input.canonicalUrlFingerprint}`;
  if (isFingerprint(input.exactContentFingerprint)) return `content:${input.exactContentFingerprint}`;
  return null;
}
