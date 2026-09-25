import type { DemandMapReadModel } from "./demand.schemas";
import {
  DEMAND_CLUSTER_STRENGTH_VERSION,
  DEMAND_CLUSTERING_VERSION,
  type DemandClusterIntentFamily,
  type DemandClusterTargetScope,
} from "./demand-clustering.policy";

/**
 * Wanterest Layer 9A: Demand Map v2. Pure read-side policy. Current demand comes
 * only from Stage 2G memberships that are still contributing when the page is
 * read; legacy snapshot data is carried as labelled history and never counted.
 * See docs/architecture.md §16 "Layer 9A".
 */

export const DEMAND_MAP_POLICY_VERSION = "demand_map_v2" as const;
export const DEMAND_MAP_MAX_BUYER_LANGUAGE = 3;

export type DemandMapLevel = "single" | "repeated" | "corroborated";

export type DemandMapClusterInput = {
  clusterId: string;
  clusterKey: string;
  label: string;
  anchorConceptKey: string;
  intentFamily: DemandClusterIntentFamily;
  targetScope: DemandClusterTargetScope;
  evidenceNodeId: string;
  state: { sequence: number; level: string; score: number; computedAt: string; evidenceNodeId: string; historyLength: number } | null;
};

export type DemandMapMemberInput = {
  membershipId: string;
  clusterId: string;
  matchEvaluationId: string;
  productMatchId: string;
  conversationId: string;
  sourceKey: string;
  evidenceAt: string;
  evidenceNodeId: string;
  /** What the latest persisted state recorded for this membership. */
  persisted: { inLatestState: boolean; contributes: boolean; reason: string | null };
  /** Lifecycle read at request time. */
  live: { found: boolean; currentEvaluationId: string | null; signalLifecycleStatus: string | null };
};

export type DemandMapResolvedMember = Omit<DemandMapMemberInput, "persisted" | "live"> & {
  contributes: boolean;
  reason: string | null;
  /** The persisted state no longer matches live lifecycle; a rebuild will append a new state. */
  pendingRecompute: boolean;
};

export type DemandMapClusterDrilldown = {
  clusterId: string;
  clusterKey: string;
  label: string;
  intentFamily: DemandClusterIntentFamily;
  targetScope: DemandClusterTargetScope;
  evidenceNodeId: string;
  activeEvidenceCount: number;
  /** Persisted Stage 2G state as recorded at computedAt; may predate live lifecycle. */
  persistedState: DemandMapClusterInput["state"];
  members: DemandMapResolvedMember[];
};

export type DemandMapConcept = {
  conceptKey: string;
  identity: { clusteringVersion: string; anchorConceptKey: string };
  label: string;
  status: "current" | "historical";
  activeEvidenceCount: number;
  activeSourceCount: number;
  sourceMix: Record<string, number>;
  intentFamilyMix: Record<string, number>;
  targetScopeMix: Record<string, number>;
  level: DemandMapLevel | null;
  firstActiveEvidenceAt: string | null;
  lastActiveEvidenceAt: string | null;
  observedEvidenceCount: number;
  lastObservedAt: string | null;
  exclusions: Record<string, number>;
  updatePending: boolean;
  stateComputedAt: string | null;
  buyerLanguage: string[];
  clusters: DemandMapClusterDrilldown[];
};

export type DemandMapV2ReadModel = {
  mapPolicyVersion: typeof DEMAND_MAP_POLICY_VERSION;
  clusteringVersion: string;
  strengthVersion: string;
  generatedAt: string;
  staleBefore: string;
  totals: {
    currentConceptCount: number;
    activeEvidenceCount: number;
    activeSourceCount: number;
    sourceMix: Record<string, number>;
    lastActiveEvidenceAt: string | null;
  };
  current: DemandMapConcept[];
  previouslyObserved: DemandMapConcept[];
  historical: { label: "not_lifecycle_filtered"; legacy: DemandMapReadModel | null };
  diagnostics: { clustersRead: number; membershipsRead: number; statesRead: number; statesTruncated: boolean; updatePending: boolean };
};

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function sorted(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Same level rule as demand_cluster_strength_v1, applied to live counts. Never a new score. */
export function demandMapLevel(activeEvidenceCount: number, activeSourceCount: number): DemandMapLevel | null {
  if (activeEvidenceCount <= 0) return null;
  if (activeEvidenceCount === 1) return "single";
  return activeSourceCount >= 2 ? "corroborated" : "repeated";
}

/**
 * Wanterest's single canonical definition of CURRENT (Layer 9A + 9B): checked live,
 * at read time, never trusting only what was last persisted. Every subsystem that
 * needs to know whether one piece of evidence is currently valid (the Map, Gap v2,
 * Drift v2, Digests) calls this same function — see docs/architecture.md §16/§17.
 * Returns null when the evidence is currently valid.
 */
export type DemandLifecycleExclusionReason = "evidence_unavailable" | "evaluation_superseded" | "signal_invalidated" | "signal_retracted" | "stale";

export function lifecycleExclusionReason(input: { found: boolean; matchEvaluationId: string; currentEvaluationId: string | null; signalLifecycleStatus: string | null; evidenceAt: string; staleBeforeIso: string }): DemandLifecycleExclusionReason | null {
  if (!input.found) return "evidence_unavailable";
  if (input.currentEvaluationId !== input.matchEvaluationId) return "evaluation_superseded";
  if (input.signalLifecycleStatus === "invalidated") return "signal_invalidated";
  if (input.signalLifecycleStatus === "retracted") return "signal_retracted";
  if (time(input.evidenceAt) < time(input.staleBeforeIso)) return "stale";
  return null;
}

/**
 * A membership counts only if the persisted state lists it as contributing AND it
 * is still valid now. Persisted exclusions are never revived.
 */
export function resolveDemandMapMember(member: DemandMapMemberInput, staleBeforeIso: string): DemandMapResolvedMember {
  const { persisted, live, ...rest } = member;
  const liveReason = lifecycleExclusionReason({ found: live.found, matchEvaluationId: member.matchEvaluationId, currentEvaluationId: live.currentEvaluationId, signalLifecycleStatus: live.signalLifecycleStatus, evidenceAt: member.evidenceAt, staleBeforeIso });
  if (!persisted.inLatestState) return { ...rest, contributes: false, reason: liveReason ?? "not_in_latest_state", pendingRecompute: true };
  if (!persisted.contributes) return { ...rest, contributes: false, reason: persisted.reason ?? "excluded", pendingRecompute: liveReason === null && persisted.reason !== "duplicate_conversation" && persisted.reason !== "duplicate_content" };
  if (liveReason) return { ...rest, contributes: false, reason: liveReason, pendingRecompute: true };
  return { ...rest, contributes: true, reason: null, pendingRecompute: false };
}

function byEvidence(left: DemandMapResolvedMember, right: DemandMapResolvedMember) {
  return time(left.evidenceAt) - time(right.evidenceAt) || left.membershipId.localeCompare(right.membershipId);
}

function buildConcept(anchor: string, clusters: DemandMapClusterInput[], members: DemandMapResolvedMember[], buyerLanguage: Array<{ matchEvaluationId: string; phrase: string; normalizedValue: string }>): DemandMapConcept {
  const clusterById = new Map(clusters.map((cluster) => [cluster.clusterId, cluster]));
  const ordered = [...members].sort(byEvidence);
  const seen = new Set<string>();
  const kept: DemandMapResolvedMember[] = [];
  const exclusions: Record<string, number> = {};
  const finalMembers = new Map<string, DemandMapResolvedMember>();
  for (const member of ordered) {
    let resolved = member;
    if (member.contributes && seen.has(member.conversationId)) resolved = { ...member, contributes: false, reason: "duplicate_conversation" };
    if (resolved.contributes) {
      seen.add(resolved.conversationId);
      kept.push(resolved);
    } else {
      increment(exclusions, resolved.reason ?? "excluded");
    }
    finalMembers.set(resolved.membershipId, resolved);
  }
  const sourceMix: Record<string, number> = {};
  const intentFamilyMix: Record<string, number> = {};
  const targetScopeMix: Record<string, number> = {};
  for (const member of kept) {
    increment(sourceMix, member.sourceKey);
    const cluster = clusterById.get(member.clusterId);
    if (cluster) {
      increment(intentFamilyMix, cluster.intentFamily);
      increment(targetScopeMix, cluster.targetScope);
    }
  }
  const activeSourceCount = Object.keys(sourceMix).length;
  const keptEvaluations = new Set(kept.map((member) => member.matchEvaluationId));
  const phraseGroups = new Map<string, { phrases: string[]; evaluations: Set<string> }>();
  for (const row of buyerLanguage) {
    if (!keptEvaluations.has(row.matchEvaluationId)) continue;
    const group = phraseGroups.get(row.normalizedValue) ?? { phrases: [], evaluations: new Set<string>() };
    group.phrases.push(row.phrase);
    group.evaluations.add(row.matchEvaluationId);
    phraseGroups.set(row.normalizedValue, group);
  }
  const phrases = [...phraseGroups.entries()]
    .sort(([leftKey, left], [rightKey, right]) => right.evaluations.size - left.evaluations.size || leftKey.localeCompare(rightKey))
    .slice(0, DEMAND_MAP_MAX_BUYER_LANGUAGE)
    .map(([, group]) => [...group.phrases].sort((left, right) => left.localeCompare(right))[0]);
  const allConversations = new Set(members.map((member) => member.conversationId));
  const computedTimes = clusters.map((cluster) => cluster.state?.computedAt).filter((value): value is string => Boolean(value)).sort((left, right) => time(left) - time(right));
  const updatePending = members.some((member) => member.pendingRecompute) || clusters.some((cluster) => !cluster.state && members.some((member) => member.clusterId === cluster.clusterId));
  const drilldown = [...clusters].sort((left, right) => left.clusterKey.localeCompare(right.clusterKey)).map((cluster) => {
    const clusterMembers = members.filter((member) => member.clusterId === cluster.clusterId).map((member) => finalMembers.get(member.membershipId) ?? member).sort(byEvidence);
    return {
      clusterId: cluster.clusterId,
      clusterKey: cluster.clusterKey,
      label: cluster.label,
      intentFamily: cluster.intentFamily,
      targetScope: cluster.targetScope,
      evidenceNodeId: cluster.evidenceNodeId,
      activeEvidenceCount: clusterMembers.filter((member) => member.contributes).length,
      persistedState: cluster.state,
      members: clusterMembers,
    };
  });
  return {
    conceptKey: anchor,
    identity: { clusteringVersion: DEMAND_CLUSTERING_VERSION, anchorConceptKey: anchor },
    label: humanize(anchor),
    status: kept.length ? "current" : "historical",
    activeEvidenceCount: kept.length,
    activeSourceCount,
    sourceMix: sorted(sourceMix),
    intentFamilyMix: sorted(intentFamilyMix),
    targetScopeMix: sorted(targetScopeMix),
    level: demandMapLevel(kept.length, activeSourceCount),
    firstActiveEvidenceAt: kept[0]?.evidenceAt ?? null,
    lastActiveEvidenceAt: kept.at(-1)?.evidenceAt ?? null,
    observedEvidenceCount: allConversations.size,
    lastObservedAt: ordered.at(-1)?.evidenceAt ?? null,
    exclusions: sorted(exclusions),
    updatePending,
    stateComputedAt: computedTimes[0] ?? null,
    buyerLanguage: phrases,
    clusters: drilldown,
  };
}

/** Rolls live-validated Stage 2G memberships up into market-level demand concepts. */
export function buildDemandMap(input: {
  clusters: DemandMapClusterInput[];
  members: DemandMapResolvedMember[];
  buyerLanguage: Array<{ matchEvaluationId: string; phrase: string; normalizedValue: string }>;
  legacy: DemandMapReadModel | null;
  now: Date;
  staleBefore: string;
  statesRead: number;
  statesTruncated: boolean;
}): DemandMapV2ReadModel {
  const clustersByConcept = new Map<string, DemandMapClusterInput[]>();
  for (const cluster of input.clusters) clustersByConcept.set(cluster.anchorConceptKey, [...(clustersByConcept.get(cluster.anchorConceptKey) ?? []), cluster]);
  const concepts = [...clustersByConcept.entries()].map(([anchor, clusters]) => {
    const ids = new Set(clusters.map((cluster) => cluster.clusterId));
    return buildConcept(anchor, clusters, input.members.filter((member) => ids.has(member.clusterId)), input.buyerLanguage);
  });
  const current = concepts
    .filter((concept) => concept.status === "current")
    .sort((left, right) => right.activeEvidenceCount - left.activeEvidenceCount
      || right.activeSourceCount - left.activeSourceCount
      || time(right.lastActiveEvidenceAt ?? "") - time(left.lastActiveEvidenceAt ?? "")
      || left.conceptKey.localeCompare(right.conceptKey));
  const previouslyObserved = concepts
    .filter((concept) => concept.status === "historical")
    .sort((left, right) => time(right.lastObservedAt ?? "") - time(left.lastObservedAt ?? "") || left.conceptKey.localeCompare(right.conceptKey));
  const activeConversations = new Map<string, DemandMapResolvedMember>();
  for (const concept of current) for (const cluster of concept.clusters) for (const member of cluster.members) if (member.contributes && !activeConversations.has(member.conversationId)) activeConversations.set(member.conversationId, member);
  const sourceMix: Record<string, number> = {};
  for (const member of activeConversations.values()) increment(sourceMix, member.sourceKey);
  const lastActive = [...activeConversations.values()].sort(byEvidence).at(-1)?.evidenceAt ?? null;
  return {
    mapPolicyVersion: DEMAND_MAP_POLICY_VERSION,
    clusteringVersion: DEMAND_CLUSTERING_VERSION,
    strengthVersion: DEMAND_CLUSTER_STRENGTH_VERSION,
    generatedAt: input.now.toISOString(),
    staleBefore: input.staleBefore,
    totals: {
      currentConceptCount: current.length,
      activeEvidenceCount: activeConversations.size,
      activeSourceCount: Object.keys(sourceMix).length,
      sourceMix: sorted(sourceMix),
      lastActiveEvidenceAt: lastActive,
    },
    current,
    previouslyObserved,
    historical: { label: "not_lifecycle_filtered", legacy: input.legacy },
    diagnostics: {
      clustersRead: input.clusters.length,
      membershipsRead: input.members.length,
      statesRead: input.statesRead,
      statesTruncated: input.statesTruncated,
      updatePending: concepts.some((concept) => concept.updatePending),
    },
  };
}

export function demandMapV2Enabled(value: string | null | undefined): boolean {
  return value === "true";
}

export type DemandMapView<L, V> = { mode: "legacy"; legacy: L } | { mode: "v2"; map: V };

/** Flag-gated loader: with the flag off only the legacy loader runs, unchanged. */
export async function loadDemandMapView<L, V>(input: { enabled: boolean; loadLegacy: () => Promise<L>; loadV2: () => Promise<V> }): Promise<DemandMapView<L, V>> {
  if (!input.enabled) return { mode: "legacy", legacy: await input.loadLegacy() };
  return { mode: "v2", map: await input.loadV2() };
}
