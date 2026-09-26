import type { ConversationMarketReasoning, SignalQualificationPrimaryIntent } from "./signal-qualification.schemas";
import { routeSemanticReasoning, type MaterializationSafetyReason, type SemanticReasoningReason } from "./semantic-reasoning-router";
import { detectWillingnessToPay } from "./semantic-verification.schemas";
import type { DirectionalDemand } from "./directional-demand";

export const EVIDENCE_GROUNDING_VERSION = "evidence_grounding_v1" as const;
/** 12A.3A.1 amendment: the materialization safety gate, distinct from (and layered on top of) the v1 downgrade gate above. */
export const MATERIALIZATION_SAFETY_GATE_VERSION = "materialization_safety_gate_v1" as const;

/**
 * 12A.3A.1 Amendment II (evidence_fidelity_canary_scope_v1): reuses the exact
 * allowlist design semantic_reasoning_router_v1's own shadow config already
 * uses (SEMANTIC_REASONING_SHADOW_WORKSPACE_IDS), kept as an independently
 * explicit second allowlist - never merged with or inferred from it. Fails
 * closed: EVIDENCE_FIDELITY_GROUNDING_ENABLED=true with an absent or empty
 * EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS is disabled for every workspace,
 * never read as global enablement. The workspaceId parameter is required (not
 * optional) so no call site can silently fall back to the old global-only
 * check that the previous rollout shipped.
 */
function workspaceAllowed(value: string | undefined, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean)).has(workspaceId);
}

export function evidenceFidelityGroundingEnabled(input: { env?: Record<string, string | undefined>; workspaceId: string | undefined }): boolean {
  const env = input.env ?? process.env;
  return env.EVIDENCE_FIDELITY_GROUNDING_ENABLED === "true" && workspaceAllowed(env.EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS, input.workspaceId);
}

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
export function groundDeterministicReasoning(input: { reasoning: ConversationMarketReasoning; text: string; relevance: number; noise: number; materializationRisk?: MaterializationSafetyReason[] }): { reasoning: ConversationMarketReasoning; gate: EvidenceGroundingGate } {
  const decision = routeSemanticReasoning({ deterministic: input.reasoning, text: input.text, relevance: input.relevance, noise: input.noise, materializationRisk: input.materializationRisk });
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

/**
 * 12A.3A.1 amendment: the bounded, named high-risk claim contract. Pure and
 * deterministic - no LLM call. Only meaningful to run once a candidate would
 * otherwise materialize (qualified/high_confidence_signal) on its ordinary
 * dimensions; a candidate that would reject/stay weak anyway is never a
 * materialization risk and should not be assessed (that is the deterministic
 * zero-LLM path, not a side effect of this function).
 */
export function assessMaterializationRisk(input: { primaryIntent: SignalQualificationPrimaryIntent; demand: DirectionalDemand; urgency: number | null; text: string; mentionedProducts: ConversationMarketReasoning["mentioned_products"] }): MaterializationSafetyReason[] {
  const reasons: MaterializationSafetyReason[] = [];
  if (input.primaryIntent === "switching_intent") reasons.push("high_risk_switching_claim");
  if (input.demand.source_products.length > 0 && (input.demand.demand_target_type === "third_party_product" || input.demand.demand_target_type === "category")) reasons.push("high_risk_competitor_claim");
  if (input.primaryIntent === "purchase_research" || input.primaryIntent === "vendor_evaluation") reasons.push("high_risk_purchase_claim");
  if (detectWillingnessToPay(input.text)) reasons.push("high_risk_wtp_claim");
  if (input.demand.demand_direction === "away_from_product" && input.demand.source_products.length > 0) reasons.push("high_risk_migration_claim");
  if (input.urgency !== null && input.urgency >= 0.7) reasons.push("high_risk_urgency_claim");
  if (input.mentionedProducts.some((product) => product.confidence < 0.5)) reasons.push("ambiguous_entity_claim");
  if (input.demand.speaker_role === "buyer" && input.demand.authorial_stance !== "buyer") reasons.push("ambiguous_author_stance");
  return [...new Set(reasons)];
}
