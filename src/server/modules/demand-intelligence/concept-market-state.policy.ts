import { sha256Json } from "../ingestion/hash";
import { DEMAND_GAP_V2_MIN_SCORED_EVIDENCE } from "./demand-gap-v2.policy";
import { DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE } from "./demand-drift-v2.policy";
import type { DemandMapConcept, DemandMapResolvedMember } from "./demand-map.policy";
import type { DriftSkipReason } from "./drift-comparability";

/**
 * Wanterest Layer 9C: persisted, append-only concept market/gap/drift state.
 * Pure policy only — identity, statuses and fingerprints. No reads or writes
 * here. Materialization reuses Layer 9A/9B's roll-up (DemandCurrentnessService
 * + buildDemandMap / buildDemandDriftV2) as input; it never re-derives
 * currentness with separate logic. See docs/architecture.md Section 18.
 */

export const CONCEPT_MARKET_STATE_POLICY_VERSION = "concept_market_state_v1" as const;
export const CONCEPT_GAP_STATE_POLICY_VERSION = "concept_gap_state_v1" as const;
export const CONCEPT_DRIFT_STATE_POLICY_VERSION = "concept_drift_state_v1" as const;
/** The frozen comparability rules a persisted drift state was computed under (drift-comparability.ts). */
export const CONCEPT_DRIFT_COMPARABILITY_VERSION = "drift_comparability_v1" as const;

export type ConceptGapStatus = "no_current_demand" | "directional" | "scored";

export function conceptGapStatus(activeEvidenceCount: number): ConceptGapStatus {
  if (activeEvidenceCount === 0) return "no_current_demand";
  return activeEvidenceCount < DEMAND_GAP_V2_MIN_SCORED_EVIDENCE ? "directional" : "scored";
}

function sortedMemberTuples(members: DemandMapResolvedMember[]): Array<[string, string, boolean, string]> {
  return [...members]
    .sort((left, right) => left.membershipId.localeCompare(right.membershipId))
    .map((member) => [member.membershipId, member.clusterId, member.contributes, member.reason ?? "contributes"]);
}

/**
 * Identical for a materialization run and for the live re-validation
 * immediately before an Action is written (docs/architecture.md Section 18,
 * "Action basis") — one implementation, called twice, never two definitions.
 */
export function conceptMarketStateInputFingerprint(concept: Pick<DemandMapConcept, "identity"> & { clusters: Array<{ members: DemandMapResolvedMember[] }> }): string {
  return sha256Json({
    policyVersion: CONCEPT_MARKET_STATE_POLICY_VERSION,
    clusteringVersion: concept.identity.clusteringVersion,
    anchorConceptKey: concept.identity.anchorConceptKey,
    members: sortedMemberTuples(concept.clusters.flatMap((cluster) => cluster.members)),
  });
}

export function conceptGapStateInputFingerprint(input: { marketStateId: string; marketStateInputFingerprint: string; productSnapshotId: string; productSnapshotContentHash: string }): string {
  return sha256Json({ policyVersion: CONCEPT_GAP_STATE_POLICY_VERSION, ...input });
}

export type ConceptDriftFingerprintInput = {
  clusteringVersion: string;
  anchorConceptKey: string;
  window: string;
  previousPeriodStart: string | null;
  previousPeriodEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  monitoringStartedAtBasis: string | null;
  currentWindowMemberIds: string[];
  previousWindowMemberIds: string[];
};

/** Full frozen membership sets, never counts alone and never just the two state ids. */
export function conceptDriftStateInputFingerprint(input: ConceptDriftFingerprintInput): string {
  return sha256Json({
    policyVersion: CONCEPT_DRIFT_STATE_POLICY_VERSION,
    comparabilityVersion: CONCEPT_DRIFT_COMPARABILITY_VERSION,
    clusteringVersion: input.clusteringVersion,
    anchorConceptKey: input.anchorConceptKey,
    window: input.window,
    previousPeriodStart: input.previousPeriodStart,
    previousPeriodEnd: input.previousPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    monitoringStartedAtBasis: input.monitoringStartedAtBasis,
    currentWindowMemberIds: [...input.currentWindowMemberIds].sort(),
    previousWindowMemberIds: [...input.previousWindowMemberIds].sort(),
  });
}

export const CONCEPT_DRIFT_MIN_WINDOW_EVIDENCE = DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE;

export type ConceptDriftComparabilityReason = DriftSkipReason;
