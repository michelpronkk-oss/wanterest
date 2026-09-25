import type { SignalQualification } from "../intelligence/signal-qualification.schemas";
import { sha256Json } from "../ingestion/hash";

/**
 * Wanterest 1B Stage 2G: deterministic demand clustering and strengthening.
 *
 * Pure policy only. Identity reuses primitives the frozen qualification already
 * persists on every evaluation (matched Demand Profile concept keys, primary
 * intent, demand target type); nothing here re-scores, re-qualifies or changes
 * a threshold. See docs/architecture.md §15 "Stage 2G".
 */

export const DEMAND_CLUSTERING_VERSION = "demand_clustering_v1" as const;
export const DEMAND_CLUSTER_STRENGTH_VERSION = "demand_cluster_strength_v1" as const;
/** Evidence older than this no longer contributes to active strength. */
export const DEMAND_CLUSTER_STALE_AFTER_DAYS = 90;
/** Upper bound of qualified evaluations considered per product per run. */
export const DEMAND_CLUSTERING_MAX_EVALUATIONS = 500;

export type DemandClusterIntentFamily = "switch" | "evaluate" | "capability" | "pain" | "unspecified";
export type DemandClusterTargetScope = "product" | "market" | "implementation";
export type DemandClusterStrengthLevel = "inactive" | "single" | "repeated" | "corroborated";

const INTENT_FAMILY: Record<SignalQualification["primary_intent"], DemandClusterIntentFamily> = {
  switching_intent: "switch",
  alternative_search: "switch",
  renewal_reconsideration: "switch",
  comparison_intent: "evaluate",
  vendor_evaluation: "evaluate",
  purchase_research: "evaluate",
  recommendation_request: "evaluate",
  feature_requirement: "capability",
  explicit_pain: "pain",
  unmet_need: "pain",
  problem_solution_search: "pain",
  unknown: "unspecified",
};

const INTENT_FAMILY_LABEL: Record<DemandClusterIntentFamily, string> = {
  switch: "switching demand",
  evaluate: "evaluation demand",
  capability: "capability request",
  pain: "pain",
  unspecified: "demand",
};

export function intentFamilyOf(primaryIntent: SignalQualification["primary_intent"]): DemandClusterIntentFamily {
  return INTENT_FAMILY[primaryIntent] ?? "unspecified";
}

export function targetScopeOf(targetType: SignalQualification["demand_target_type"]): DemandClusterTargetScope {
  if (targetType === "scanned_product") return "product";
  if (targetType === "implementation") return "implementation";
  return "market";
}

/** Normalizes a persisted profile concept key to the stored `[a-z0-9_]` form. */
export function normalizeConceptKey(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120).replace(/_+$/g, "");
  return key.length ? key : null;
}

export type DemandClusterIdentity = {
  clusteringVersion: typeof DEMAND_CLUSTERING_VERSION;
  clusterKey: string;
  anchorConceptKey: string;
  intentFamily: DemandClusterIntentFamily;
  targetScope: DemandClusterTargetScope;
  label: string;
  assignment: {
    rule: string;
    anchorConceptKey: string;
    matchedProfileConcepts: string[];
    primaryIntent: SignalQualification["primary_intent"];
    intentFamily: DemandClusterIntentFamily;
    demandTargetType: SignalQualification["demand_target_type"];
    targetScope: DemandClusterTargetScope;
    sourceProducts: string[];
    qualificationVersion: string;
    thresholdVersion: string;
    qualificationStatus: SignalQualification["status"];
  };
};

export type DemandClusterIdentityResult =
  | { clusterable: true; identity: DemandClusterIdentity }
  | { clusterable: false; reason: "not_qualified" | "no_profile_concept" };

export const DEMAND_CLUSTER_RULE = "anchor = first matched Demand Profile concept (qualification order); key = concept + intent family + target scope";

function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Deterministic cluster identity for one stored qualification. `qualified`
 * must be the frozen materialization gate result for the same qualification.
 */
export function demandClusterIdentity(qualification: SignalQualification | null, qualified: boolean): DemandClusterIdentityResult {
  if (!qualification || !qualified) return { clusterable: false, reason: "not_qualified" };
  const concepts = qualification.matched_profile_concepts.map(normalizeConceptKey).filter((key): key is string => key !== null);
  const anchor = concepts[0];
  if (!anchor) return { clusterable: false, reason: "no_profile_concept" };
  const intentFamily = intentFamilyOf(qualification.primary_intent);
  const targetScope = targetScopeOf(qualification.demand_target_type);
  const clusterKey = `concept:${anchor}|intent:${intentFamily}|target:${targetScope}`;
  const scopeSuffix = targetScope === "product" ? " (product request)" : targetScope === "implementation" ? " (implementation)" : "";
  return {
    clusterable: true,
    identity: {
      clusteringVersion: DEMAND_CLUSTERING_VERSION,
      clusterKey,
      anchorConceptKey: anchor,
      intentFamily,
      targetScope,
      label: `${humanize(anchor)} - ${INTENT_FAMILY_LABEL[intentFamily]}${scopeSuffix}`.slice(0, 200),
      assignment: {
        rule: DEMAND_CLUSTER_RULE,
        anchorConceptKey: anchor,
        matchedProfileConcepts: concepts,
        primaryIntent: qualification.primary_intent,
        intentFamily,
        demandTargetType: qualification.demand_target_type,
        targetScope,
        sourceProducts: [...qualification.source_products],
        qualificationVersion: qualification.version,
        thresholdVersion: qualification.diagnostics.threshold_version,
        qualificationStatus: qualification.status,
      },
    },
  };
}

export type DemandClusterExclusionReason =
  | "evaluation_superseded"
  | "signal_invalidated"
  | "signal_retracted"
  | "stale"
  | "duplicate_conversation"
  | "duplicate_content"
  | "evidence_unavailable";

/** Everything the strength policy needs about one membership, read at compute time. */
export type DemandClusterMemberEvidence = {
  membershipId: string;
  matchEvaluationId: string;
  conversationId: string;
  sourceKey: string;
  evidenceAt: string;
  /** Null when the underlying evaluation/conversation could not be loaded. */
  available: boolean;
  isCurrentEvaluation: boolean;
  signalLifecycleStatus: string | null;
  contentHash: string | null;
  demandQuality: number;
  confidence: number;
  primaryIntent: string;
  sourceProducts: string[];
  createdAt: string;
};

export type DemandClusterMemberContribution = {
  membershipId: string;
  contributes: boolean;
  reason: DemandClusterExclusionReason | null;
};

export type DemandClusterStrength = {
  strengthVersion: typeof DEMAND_CLUSTER_STRENGTH_VERSION;
  inputFingerprint: string;
  level: DemandClusterStrengthLevel;
  score: number;
  distinctEvidenceCount: number;
  distinctSourceCount: number;
  contributingMembershipCount: number;
  excludedMembershipCount: number;
  averageDemandQuality: number;
  averageConfidence: number;
  components: { evidenceFactor: number; sourceFactor: number; averageDemandQuality: number; formula: string };
  sourceMix: Record<string, number>;
  intentMix: Record<string, number>;
  alternativeMix: Record<string, number>;
  lifecycleMix: Record<string, number>;
  exclusions: Record<string, number>;
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
  staleBefore: string;
  contributions: DemandClusterMemberContribution[];
};

export const DEMAND_CLUSTER_STRENGTH_FORMULA = "score = avg_demand_quality x (1 - 0.5^distinct_evidence) x (1 if distinct_sources >= 2 else 0.85)";

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 1_000_000) / 1_000_000;
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function sortedRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function staleBefore(now: Date): string {
  return new Date(now.getTime() - DEMAND_CLUSTER_STALE_AFTER_DAYS * 86_400_000).toISOString();
}

function exclusionReason(member: DemandClusterMemberEvidence, cutoff: string): DemandClusterExclusionReason | null {
  if (!member.available) return "evidence_unavailable";
  if (!member.isCurrentEvaluation) return "evaluation_superseded";
  if (member.signalLifecycleStatus === "invalidated") return "signal_invalidated";
  if (member.signalLifecycleStatus === "retracted") return "signal_retracted";
  if (member.evidenceAt < cutoff) return "stale";
  return null;
}

/**
 * Strength from distinct evidence only. Processing the same evidence twice
 * yields the same memberships and therefore the same result and fingerprint.
 * Members are visited in a canonical order so duplicate collapsing is stable.
 */
export function computeDemandClusterStrength(members: DemandClusterMemberEvidence[], now: Date): DemandClusterStrength {
  const cutoff = staleBefore(now);
  const ordered = [...members].sort((left, right) => left.evidenceAt.localeCompare(right.evidenceAt) || left.createdAt.localeCompare(right.createdAt) || left.membershipId.localeCompare(right.membershipId));
  const seenConversations = new Set<string>();
  const seenContent = new Set<string>();
  const contributions: DemandClusterMemberContribution[] = [];
  const contributing: DemandClusterMemberEvidence[] = [];
  const exclusions: Record<string, number> = {};
  const lifecycleMix: Record<string, number> = {};
  for (const member of ordered) {
    let reason = exclusionReason(member, cutoff);
    if (!reason && seenConversations.has(member.conversationId)) reason = "duplicate_conversation";
    if (!reason && member.contentHash && seenContent.has(member.contentHash)) reason = "duplicate_content";
    if (member.available) increment(lifecycleMix, member.signalLifecycleStatus ?? "no_signal");
    if (reason) {
      increment(exclusions, reason);
      contributions.push({ membershipId: member.membershipId, contributes: false, reason });
      continue;
    }
    seenConversations.add(member.conversationId);
    if (member.contentHash) seenContent.add(member.contentHash);
    contributing.push(member);
    contributions.push({ membershipId: member.membershipId, contributes: true, reason: null });
  }
  const sourceMix: Record<string, number> = {};
  const intentMix: Record<string, number> = {};
  const alternativeMix: Record<string, number> = {};
  for (const member of contributing) {
    increment(sourceMix, member.sourceKey);
    increment(intentMix, member.primaryIntent);
    for (const product of new Set(member.sourceProducts.map((item) => item.trim().toLowerCase()).filter(Boolean))) increment(alternativeMix, product);
  }
  const distinctEvidenceCount = contributing.length;
  const distinctSourceCount = Object.keys(sourceMix).length;
  const averageDemandQuality = distinctEvidenceCount ? contributing.reduce((sum, item) => sum + item.demandQuality, 0) / distinctEvidenceCount : 0;
  const averageConfidence = distinctEvidenceCount ? contributing.reduce((sum, item) => sum + item.confidence, 0) / distinctEvidenceCount : 0;
  const evidenceFactor = 1 - 0.5 ** distinctEvidenceCount;
  const sourceFactor = distinctSourceCount >= 2 ? 1 : 0.85;
  const level: DemandClusterStrengthLevel = distinctEvidenceCount === 0 ? "inactive" : distinctEvidenceCount === 1 ? "single" : distinctSourceCount >= 2 ? "corroborated" : "repeated";
  const sortedContributions = [...contributions].sort((left, right) => left.membershipId.localeCompare(right.membershipId));
  const inputFingerprint = sha256Json({
    strengthVersion: DEMAND_CLUSTER_STRENGTH_VERSION,
    contributions: sortedContributions.map((item) => [item.membershipId, item.reason ?? "contributes"]),
  });
  return {
    strengthVersion: DEMAND_CLUSTER_STRENGTH_VERSION,
    inputFingerprint,
    level,
    score: round(averageDemandQuality * evidenceFactor * sourceFactor),
    distinctEvidenceCount,
    distinctSourceCount,
    contributingMembershipCount: contributing.length,
    excludedMembershipCount: contributions.length - contributing.length,
    averageDemandQuality: round(averageDemandQuality),
    averageConfidence: round(averageConfidence),
    components: { evidenceFactor: round(evidenceFactor), sourceFactor, averageDemandQuality: round(averageDemandQuality), formula: DEMAND_CLUSTER_STRENGTH_FORMULA },
    sourceMix: sortedRecord(sourceMix),
    intentMix: sortedRecord(intentMix),
    alternativeMix: sortedRecord(alternativeMix),
    lifecycleMix: sortedRecord(lifecycleMix),
    exclusions: sortedRecord(exclusions),
    firstEvidenceAt: contributing[0]?.evidenceAt ?? null,
    lastEvidenceAt: contributing.at(-1)?.evidenceAt ?? null,
    staleBefore: cutoff,
    contributions: sortedContributions,
  };
}

/** Plain-language answer to "why are these grouped?". */
export function explainDemandCluster(input: { anchorConceptKey: string; intentFamily: DemandClusterIntentFamily; targetScope: DemandClusterTargetScope; distinctEvidenceCount: number; distinctSourceCount: number }): string {
  const members = Object.entries(INTENT_FAMILY).filter(([, family]) => family === input.intentFamily).map(([intent]) => intent).join(", ");
  const evidence = input.distinctEvidenceCount === 1 ? "1 distinct piece of evidence" : `${input.distinctEvidenceCount} distinct pieces of evidence`;
  const sources = input.distinctSourceCount === 1 ? "1 source" : `${input.distinctSourceCount} sources`;
  return `${evidence} from ${sources} matched the product profile concept "${input.anchorConceptKey}" as their primary concept, with intent family "${input.intentFamily}" (${members}) and target scope "${input.targetScope}".`;
}

export function demandClusterIdempotencyKeys(input: { workspaceId: string; productId: string; clusterKey: string; matchEvaluationId?: string }) {
  return {
    cluster: `stage2g:cluster:${input.workspaceId}:${input.productId}:${DEMAND_CLUSTERING_VERSION}:${input.clusterKey}`,
    membership: input.matchEvaluationId ? `stage2g:membership:${input.workspaceId}:${input.productId}:${DEMAND_CLUSTERING_VERSION}:${input.matchEvaluationId}` : null,
  };
}
