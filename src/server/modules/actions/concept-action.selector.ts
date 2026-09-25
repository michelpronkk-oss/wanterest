import type { ActionRow, ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import { sha256Json } from "../ingestion/hash";
import { staleBefore } from "../demand-intelligence/demand-clustering.policy";
import {
  CONCEPT_DRIFT_STATE_POLICY_VERSION,
  CONCEPT_GAP_STATE_POLICY_VERSION,
  CONCEPT_MARKET_STATE_POLICY_VERSION,
  conceptMarketStateInputFingerprint,
  expectedConceptDriftStateFingerprint,
} from "../demand-intelligence/concept-market-state.policy";
import type { ConceptDriftStateRow, ConceptGapStateRow, ConceptMarketStateRow } from "../demand-intelligence/concept-market-state.repository";
import type { DemandMapConcept } from "../demand-intelligence/demand-map.policy";
import { actionInputFromConceptDrift, actionInputFromConceptGap } from "./action.candidates";
import { actionCandidateIsQualified, actionShapeFor, FixtureDemandActionEngine } from "./action.engines";
import { isConceptTriggerType, isOpenActionStatus, type ActionGenerationInput, type ActionStatus, type ActionType, type ConceptActionTriggerType, type UserActionTransition } from "./action.schemas";

/**
 * Wanterest Layer 10 — the ONE canonical concept-Action selector.
 *
 * Pure: no reads, no writes. Used by generation, write-side reconciliation, the
 * Action list and detail read models, approve and start — there is no second
 * priority implementation anywhere. See docs/architecture.md Section 21.
 */

export const ACTION_PROPOSAL_CONTINUITY_VERSION = "action_proposal_continuity_v1" as const;
export const CONCEPT_ACTION_DRIFT_WINDOWS = ["7d", "30d", "90d"] as const;
export type ConceptActionDriftWindow = (typeof CONCEPT_ACTION_DRIFT_WINDOWS)[number];
/** The deterministic action engine whose templates the proposal fingerprint describes. */
export const CONCEPT_ACTION_ENGINE_VERSION = new FixtureDemandActionEngine().version;

export type ConceptIdentity = {
  workspaceId: string;
  productId: string;
  clusteringVersion: string;
  anchorConceptKey: string;
};

export type ConceptSelectorInputs = {
  product: ProductRow;
  /** Latest persisted market state for this concept (bounded batch read). */
  marketState: ConceptMarketStateRow | null;
  /** Latest persisted gap state for this concept. */
  gapState: ConceptGapStateRow | null;
  /** Latest persisted drift state per supported window. */
  driftStates: Partial<Record<ConceptActionDriftWindow, ConceptDriftStateRow | null>>;
  /** This concept in the live DemandCurrentnessService roll-up (null when it no longer rolls up). */
  liveConcept: DemandMapConcept | null;
  /** Current positioning snapshot (`current_snapshot_id`, else latest version). */
  positioning: ProductSnapshotRow | null;
  /** Same bounded monitoring-start read 9C materialization uses. */
  monitoringStartedAt: string | null;
  /** The clustering version this deployment materializes/validates. */
  activeClusteringVersion: string;
};

export type ConceptSelectionPendingReason =
  | "currentness"
  | "gap_materialization"
  | "drift_materialization"
  | "positioning"
  | "clustering_version_unsupported";

export type ConceptBasisGuard = {
  marketStatePolicyVersion: string;
  marketStateId: string;
  gapStatePolicyVersion: string;
  gapStateId: string | null;
  driftStatePolicyVersion: string;
  driftStateIds: Record<ConceptActionDriftWindow, string | null>;
};

export type CanonicalConceptActionCandidate = {
  identity: ConceptIdentity;
  triggerType: ConceptActionTriggerType;
  basisStateId: string;
  basisEvidenceNodeId: string;
  basisSequence: number;
  window: ConceptActionDriftWindow | null;
  actionType: ActionType;
  targetKey: string;
  input: ActionGenerationInput;
  proposalFingerprint: string;
  basisGuard: ConceptBasisGuard;
  /** Deterministic generation ordering (gap score / |share delta|). */
  opportunity: number;
};

export type ConceptSelection =
  | { state: "pending"; reason: ConceptSelectionPendingReason }
  | { state: "settled"; candidate: CanonicalConceptActionCandidate | null; reason?: "no_market_state" | "market_state_stale" | "no_eligible_basis" };

const SIGNIFICANCE_RANK: Record<string, number> = { strong: 2, notable: 1 };

/**
 * action_proposal_continuity_v1: hashes only what changes the deterministic
 * recommendation. State ids, drift period boundaries, the drift window and raw
 * scores are deliberately excluded, so a daily drift state or a window switch
 * with the same meaning keeps the same fingerprint.
 */
export function conceptProposalFingerprint(input:
  | { triggerType: "concept_gap"; engineVersion: string; basisPolicyVersion: string; clusteringVersion: string; anchorConceptKey: string; productName: string; actionType: string; targetKey: string; sampleQuality: string; productSnapshotId: string; productSnapshotContentHash: string }
  | { triggerType: "concept_drift"; engineVersion: string; basisPolicyVersion: string; clusteringVersion: string; anchorConceptKey: string; productName: string; actionType: string; targetKey: string; sampleQuality: string; direction: string | null; significance: string | null },
): string {
  return sha256Json({ continuityVersion: ACTION_PROPOSAL_CONTINUITY_VERSION, ...input });
}

function guardFor(inputs: ConceptSelectorInputs, marketState: ConceptMarketStateRow): ConceptBasisGuard {
  const driftStateIds = Object.fromEntries(CONCEPT_ACTION_DRIFT_WINDOWS.map((window) => [window, inputs.driftStates[window]?.id ?? null])) as Record<ConceptActionDriftWindow, string | null>;
  return {
    marketStatePolicyVersion: CONCEPT_MARKET_STATE_POLICY_VERSION,
    marketStateId: marketState.id,
    gapStatePolicyVersion: CONCEPT_GAP_STATE_POLICY_VERSION,
    gapStateId: inputs.gapState?.id ?? null,
    driftStatePolicyVersion: CONCEPT_DRIFT_STATE_POLICY_VERSION,
    driftStateIds,
  };
}

/** A drift state is caught up if it belongs to the latest market state, or it reproduces exactly from the live roll-up (a legitimately unchanged window). */
function driftCaughtUp(inputs: ConceptSelectorInputs, marketState: ConceptMarketStateRow, drift: ConceptDriftStateRow, window: ConceptActionDriftWindow, now: Date): boolean {
  if (drift.market_state_id === marketState.id) return true;
  if (!inputs.liveConcept) return false;
  const expected = expectedConceptDriftStateFingerprint({ concept: inputs.liveConcept, clusteringVersion: drift.clustering_version, window, now, monitoringStartedAt: inputs.monitoringStartedAt });
  return expected === drift.input_fingerprint;
}

export function selectCanonicalConceptCandidate(identity: ConceptIdentity, inputs: ConceptSelectorInputs, now: Date): ConceptSelection {
  if (identity.clusteringVersion !== inputs.activeClusteringVersion) return { state: "pending", reason: "clustering_version_unsupported" };

  // 1. No usable market state.
  const marketState = inputs.marketState;
  if (!marketState) return { state: "settled", candidate: null, reason: "no_market_state" };
  if (marketState.computed_at < staleBefore(now)) return { state: "settled", candidate: null, reason: "market_state_stale" };

  // 2. Live currentness must equal the persisted market state.
  const liveFingerprint = inputs.liveConcept ? conceptMarketStateInputFingerprint(inputs.liveConcept) : null;
  if (liveFingerprint !== marketState.input_fingerprint) return { state: "pending", reason: "currentness" };

  // 3. Materialization-lag guardrail: incomplete derived state is never "no candidate".
  const gap = inputs.gapState;
  if (inputs.positioning && (!gap || gap.market_state_id !== marketState.id)) return { state: "pending", reason: "gap_materialization" };
  for (const window of CONCEPT_ACTION_DRIFT_WINDOWS) {
    const drift = inputs.driftStates[window];
    if (!drift || !driftCaughtUp(inputs, marketState, drift, window, now)) return { state: "pending", reason: "drift_materialization" };
  }

  // 4. Positioning moved on after the gap state was materialized.
  if (inputs.positioning && gap && gap.product_snapshot_id !== inputs.positioning.id) return { state: "pending", reason: "positioning" };

  const basisGuard = guardFor(inputs, marketState);

  // 5. Eligible scored Gap wins.
  if (inputs.positioning && gap && gap.status === "scored") {
    const input = actionInputFromConceptGap(inputs.product, gap, marketState);
    if (actionCandidateIsQualified(input)) {
      const shape = actionShapeFor(input);
      return {
        state: "settled",
        candidate: {
          identity, triggerType: "concept_gap", basisStateId: gap.id, basisEvidenceNodeId: gap.evidence_node_id, basisSequence: gap.sequence, window: null,
          actionType: shape.actionType, targetKey: shape.targetKey, input, basisGuard, opportunity: gap.gap_score ?? 0,
          proposalFingerprint: conceptProposalFingerprint({
            triggerType: "concept_gap", engineVersion: CONCEPT_ACTION_ENGINE_VERSION, basisPolicyVersion: gap.gap_state_policy_version,
            clusteringVersion: gap.clustering_version, anchorConceptKey: gap.anchor_concept_key, productName: inputs.product.name,
            actionType: shape.actionType, targetKey: shape.targetKey, sampleQuality: input.sampleQuality,
            productSnapshotId: inputs.positioning.id, productSnapshotContentHash: inputs.positioning.content_hash,
          }),
        },
      };
    }
  }

  // 6. Otherwise the best eligible Drift: strong > notable, then 7d < 30d < 90d, then state id.
  const drifts = CONCEPT_ACTION_DRIFT_WINDOWS
    .map((window, windowRank) => ({ window, windowRank, drift: inputs.driftStates[window]! }))
    .filter(({ drift }) => drift.comparable && drift.direction === "rising" && (drift.significance === "notable" || drift.significance === "strong"))
    .map((entry) => ({ ...entry, input: actionInputFromConceptDrift(inputs.product, entry.drift, marketState) }))
    .filter((entry) => actionCandidateIsQualified(entry.input))
    .sort((left, right) => (SIGNIFICANCE_RANK[right.drift.significance ?? ""] ?? 0) - (SIGNIFICANCE_RANK[left.drift.significance ?? ""] ?? 0) || left.windowRank - right.windowRank || left.drift.id.localeCompare(right.drift.id));
  const best = drifts[0];
  if (best) {
    const shape = actionShapeFor(best.input);
    return {
      state: "settled",
      candidate: {
        identity, triggerType: "concept_drift", basisStateId: best.drift.id, basisEvidenceNodeId: best.drift.evidence_node_id, basisSequence: best.drift.sequence, window: best.window,
        actionType: shape.actionType, targetKey: shape.targetKey, input: best.input, basisGuard, opportunity: Math.abs(best.drift.share_delta ?? 0),
        proposalFingerprint: conceptProposalFingerprint({
          triggerType: "concept_drift", engineVersion: CONCEPT_ACTION_ENGINE_VERSION, basisPolicyVersion: best.drift.drift_state_policy_version,
          clusteringVersion: best.drift.clustering_version, anchorConceptKey: best.drift.anchor_concept_key, productName: inputs.product.name,
          actionType: shape.actionType, targetKey: shape.targetKey, sampleQuality: best.input.sampleQuality,
          direction: best.drift.direction, significance: best.drift.significance,
        }),
      },
    };
  }

  // 7. Nothing eligible.
  return { state: "settled", candidate: null, reason: "no_eligible_basis" };
}

/** Whether a persisted basis row (gap or drift) qualifies on its own — the same predicate the selector applies. Used by the episode-break lookup. */
export function gapStateQualifies(product: ProductRow, gap: ConceptGapStateRow, marketState: ConceptMarketStateRow): boolean {
  return gap.status === "scored" && actionCandidateIsQualified(actionInputFromConceptGap(product, gap, marketState));
}

export function driftStateQualifies(product: ProductRow, drift: ConceptDriftStateRow, marketState: ConceptMarketStateRow): boolean {
  return drift.comparable && drift.direction === "rising" && (drift.significance === "notable" || drift.significance === "strong")
    && actionCandidateIsQualified(actionInputFromConceptDrift(product, drift, marketState));
}

export type ActionBasisStatus = "valid" | "update_pending" | "invalid";

export type ActionLiveBasis = {
  basisStatus: ActionBasisStatus | null;
  proposalCurrent: boolean | null;
  pendingReason: ConceptSelectionPendingReason | null;
  allowedTransitions: UserActionTransition[];
  executionMode: "manual";
};

export function conceptIdentityOf(action: Pick<ActionRow, "workspace_id" | "product_id" | "trigger_clustering_version" | "trigger_concept_key">): ConceptIdentity | null {
  if (!action.trigger_clustering_version) return null;
  return { workspaceId: action.workspace_id, productId: action.product_id, clusteringVersion: action.trigger_clustering_version, anchorConceptKey: action.trigger_concept_key };
}

/**
 * Derived, read-only current safety state of one Action given the canonical
 * selection for its concept. Persisted `status` stays historical workflow state.
 * Approve/start require a settled candidate with the Action's own fingerprint and
 * the plan; complete/dismiss only require the (separately checked) role.
 */
export function evaluateActionLiveBasis(input: {
  action: Pick<ActionRow, "status" | "trigger_type" | "proposal_fingerprint">;
  selection: ConceptSelection | null;
  actionsEnabled: boolean;
  downstreamIntelligenceV2Enabled: boolean;
  canMutate: boolean;
}): ActionLiveBasis {
  const status = input.action.status as ActionStatus;
  const concept = isConceptTriggerType(input.action.trigger_type);
  let basisStatus: ActionBasisStatus | null = null;
  let proposalCurrent: boolean | null = null;
  let pendingReason: ConceptSelectionPendingReason | null = null;
  if (concept && isOpenActionStatus(status) && input.selection) {
    if (input.selection.state === "pending") { basisStatus = "update_pending"; proposalCurrent = false; pendingReason = input.selection.reason; }
    else if (!input.selection.candidate) { basisStatus = "invalid"; proposalCurrent = false; }
    else { basisStatus = "valid"; proposalCurrent = input.selection.candidate.proposalFingerprint === input.action.proposal_fingerprint; }
  }
  const allowed: UserActionTransition[] = [];
  if (input.canMutate) {
    const verifiedForWork = concept
      ? basisStatus === "valid" && proposalCurrent === true
      : !input.downstreamIntelligenceV2Enabled;
    if (status === "proposed" && verifiedForWork && input.actionsEnabled) allowed.push("approved");
    if (status === "approved" && verifiedForWork && input.actionsEnabled) allowed.push("in_progress");
    if (status === "in_progress") allowed.push("completed");
    if (isOpenActionStatus(status)) allowed.push("dismissed");
  }
  return { basisStatus, proposalCurrent, pendingReason, allowedTransitions: allowed, executionMode: "manual" };
}
