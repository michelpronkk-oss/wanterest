import type { ConversationMarketReasoning } from "./signal-qualification.schemas";
import { routeSemanticReasoning, type SemanticReasoningReason } from "./semantic-reasoning-router";

export const EVIDENCE_GROUNDING_VERSION = "evidence_grounding_v1" as const;

/** Minimum-safe temporal fix: past this age, wording must not imply current/ongoing demand. */
export const EVIDENCE_HISTORICAL_THRESHOLD_DAYS = 90;

export type EvidenceGroundingClaimType = "mentioned_product_identity";

export type EvidenceGroundingGate = {
  version: typeof EVIDENCE_GROUNDING_VERSION;
  verificationRequired: boolean;
  reasons: SemanticReasoningReason[];
  downgradedClaimTypes: EvidenceGroundingClaimType[];
};

/**
 * Applies semantic_reasoning_router_v1's own routing decision as a fail-closed
 * gate on deterministic-only reasoning (no reasoningOverride available). The
 * router's three reasons ("ambiguous_direction", "unclear_buyer_context",
 * "unknown_product_entity") all fire when the deterministic pass is already
 * conservative/uncertain (direction unknown, buyer_context false, or a
 * low-confidence entity mention) - never when it is confidently wrong, so
 * there is nothing to downgrade for direction or buyer_context: the safe
 * default is already in place, and the gate's job is to make that fact
 * auditable (verificationRequired = true) rather than let a later, unverified
 * shadow result silently apply. The one field genuinely worth acting on
 * without verification is a low-confidence mentioned-product entity: it is
 * dropped from the record rather than left to be read as a confirmed mention
 * downstream. This never fails the candidate: dimensions are recomputed from
 * the (possibly trimmed) reasoning and the candidate can still qualify on its
 * remaining dimensions (pain, specificity, evidence quality, ...).
 */
export function groundDeterministicReasoning(input: { reasoning: ConversationMarketReasoning; text: string; relevance: number; noise: number }): { reasoning: ConversationMarketReasoning; gate: EvidenceGroundingGate } {
  const decision = routeSemanticReasoning({ deterministic: input.reasoning, text: input.text, relevance: input.relevance, noise: input.noise });
  if (decision.route !== "llm_reasoning") {
    return { reasoning: input.reasoning, gate: { version: EVIDENCE_GROUNDING_VERSION, verificationRequired: false, reasons: decision.reasons, downgradedClaimTypes: [] } };
  }
  let reasoning = input.reasoning;
  const downgradedClaimTypes: EvidenceGroundingClaimType[] = [];
  if (decision.reasons.includes("unknown_product_entity")) {
    const kept = reasoning.mentioned_products.filter((product) => product.confidence >= 0.5);
    if (kept.length !== reasoning.mentioned_products.length) {
      reasoning = { ...reasoning, mentioned_products: kept };
      downgradedClaimTypes.push("mentioned_product_identity");
    }
  }
  return { reasoning, gate: { version: EVIDENCE_GROUNDING_VERSION, verificationRequired: true, reasons: decision.reasons, downgradedClaimTypes } };
}

/** Literal published date plus, past the historical threshold, an explicit non-currency qualifier. */
export function temporalGroundingClause(publishedAt: string | null, now: Date): string {
  if (!publishedAt) return "";
  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) return "";
  const ageDays = Math.floor((now.getTime() - publishedDate.getTime()) / 86_400_000);
  const isoDate = publishedAt.slice(0, 10);
  if (ageDays >= EVIDENCE_HISTORICAL_THRESHOLD_DAYS) return ` This was published on ${isoDate} and may not reflect current demand.`;
  return ` Published on ${isoDate}.`;
}
