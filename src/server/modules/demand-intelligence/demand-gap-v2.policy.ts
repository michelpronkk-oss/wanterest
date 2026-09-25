import type { ProductSnapshotRow } from "../../db/database.helpers";
import { calculateGapScore, calculatePositioningWeight, sampleFactor } from "./demand.engines";
import type { DemandMapConcept } from "./demand-map.policy";

/**
 * Wanterest Layer 9B: Demand Gap v2. Pure, not persisted. Reuses the frozen
 * calculateGapScore / calculatePositioningWeight / sampleFactor formulas fed
 * from live-validated Stage 2G current concepts (Layer 9A) instead of the
 * legacy, lifecycle-blind snapshot/theme pipeline. See docs/architecture.md §17.
 */

export const DEMAND_GAP_V2_POLICY_VERSION = "demand_gap_v2" as const;
/** Below this many current, distinct pieces of evidence, a gap is directional only — never scored. */
export const DEMAND_GAP_V2_MIN_SCORED_EVIDENCE = 5;

export type DemandGapV2SampleQuality = "insufficient_data" | "low_confidence" | "normal" | "high_confidence";

export type DemandGapV2Item = {
  conceptKey: string;
  label: string;
  identity: DemandMapConcept["identity"];
  activeEvidenceCount: number;
  activeSourceCount: number;
  shareOfCurrentDemand: number;
  positioningWeight: number;
  highIntentShare: number;
  /** True once activeEvidenceCount >= DEMAND_GAP_V2_MIN_SCORED_EVIDENCE. Below that, gapScore is null. */
  scored: boolean;
  gapScore: number | null;
  sampleQuality: DemandGapV2SampleQuality;
  interpretation: string;
};

export type DemandGapV2ReadModel = {
  policyVersion: typeof DEMAND_GAP_V2_POLICY_VERSION;
  generatedAt: string;
  hasCurrentEvidence: boolean;
  items: DemandGapV2Item[];
};

/** Same four-tier bucketing demand.service.ts already uses for snapshot sample quality. */
export function demandGapV2SampleQuality(activeEvidenceCount: number): DemandGapV2SampleQuality {
  return activeEvidenceCount < DEMAND_GAP_V2_MIN_SCORED_EVIDENCE ? "insufficient_data" : activeEvidenceCount < 20 ? "low_confidence" : activeEvidenceCount < 50 ? "normal" : "high_confidence";
}

/** Switch and evaluate intent families read as high commercial intent, same as the legacy HIGH_INTENT set. */
function highIntentShareOf(concept: DemandMapConcept): number {
  if (!concept.activeEvidenceCount) return 0;
  const highIntentCount = (concept.intentFamilyMix.switch ?? 0) + (concept.intentFamilyMix.evaluate ?? 0);
  return Math.max(0, Math.min(1, highIntentCount / concept.activeEvidenceCount));
}

function interpretationFor(item: Pick<DemandGapV2Item, "scored" | "gapScore" | "activeEvidenceCount">): string {
  if (!item.scored) return `Directional only: fewer than ${DEMAND_GAP_V2_MIN_SCORED_EVIDENCE} current, distinct pieces of evidence (${item.activeEvidenceCount}).`;
  const score = item.gapScore ?? 0;
  return score >= 0.65 ? "Current demand is strong while positioning gives limited emphasis." : score >= 0.35 ? "Current demand is present and positioning could make the need more explicit." : "Current evidence does not show a material positioning gap.";
}

/**
 * Only current concepts (Layer 9A: >=1 live contributing member) may produce
 * gap output. `positioning` is the product's latest snapshot text, or null when
 * none exists yet (positioningWeight is then 0, never fabricated).
 */
export function buildDemandGapV2(input: { current: DemandMapConcept[]; positioning: ProductSnapshotRow | null; now: Date }): DemandGapV2ReadModel {
  const totalActive = input.current.reduce((sum, concept) => sum + concept.activeEvidenceCount, 0);
  const items = input.current
    .map((concept): DemandGapV2Item => {
      const shareOfCurrentDemand = totalActive ? concept.activeEvidenceCount / totalActive : 0;
      const positioningWeight = input.positioning ? calculatePositioningWeight(input.positioning, concept.identity.anchorConceptKey, concept.label) : 0;
      const highIntentShare = highIntentShareOf(concept);
      const scored = concept.activeEvidenceCount >= DEMAND_GAP_V2_MIN_SCORED_EVIDENCE;
      const sampleQuality = demandGapV2SampleQuality(concept.activeEvidenceCount);
      const gapScore = scored ? calculateGapScore(shareOfCurrentDemand, positioningWeight, highIntentShare, sampleFactor(sampleQuality)) : null;
      return {
        conceptKey: concept.conceptKey, label: concept.label, identity: concept.identity,
        activeEvidenceCount: concept.activeEvidenceCount, activeSourceCount: concept.activeSourceCount,
        shareOfCurrentDemand, positioningWeight, highIntentShare, scored, gapScore, sampleQuality,
        interpretation: interpretationFor({ scored, gapScore, activeEvidenceCount: concept.activeEvidenceCount }),
      };
    })
    // Scored gaps always rank above directional ones — an unscored item's raw
    // share must never outrank a properly scored gap (no fabricated opportunity).
    .sort((left, right) => Number(right.scored) - Number(left.scored) || (right.gapScore ?? right.shareOfCurrentDemand) - (left.gapScore ?? left.shareOfCurrentDemand) || left.conceptKey.localeCompare(right.conceptKey));
  return { policyVersion: DEMAND_GAP_V2_POLICY_VERSION, generatedAt: input.now.toISOString(), hasCurrentEvidence: totalActive > 0, items };
}
