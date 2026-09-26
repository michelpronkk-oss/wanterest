import { z } from "zod";

import type { ConversationMarketReasoning } from "./signal-qualification.schemas";
import type { SignalQualificationPrimaryIntent } from "./signal-qualification.schemas";

export const SEMANTIC_VERIFICATION_VERSION = "semantic_verification_v1" as const;

export const semanticVerificationIntentTypeSchema = z.enum(["switching", "alternative_search", "purchase", "willingness_to_pay", "feature_request", "pain", "comparison", "recommendation", "other", "none"]);
export type SemanticVerificationIntentType = z.infer<typeof semanticVerificationIntentTypeSchema>;

export const semanticVerificationAuthorialStanceSchema = z.enum(["first_party_demand", "first_party_experience", "recommendation", "vendor_marketing", "technical_discussion", "descriptive_reference", "unknown"]);
export type SemanticVerificationAuthorialStance = z.infer<typeof semanticVerificationAuthorialStanceSchema>;

export const semanticVerificationTargetTypeSchema = z.enum(["tracked_product", "competitor", "category", "feature", "workflow", "none", "ambiguous"]);
export type SemanticVerificationTargetType = z.infer<typeof semanticVerificationTargetTypeSchema>;

export const semanticVerificationClaimStrengthSchema = z.enum(["explicit", "strongly_supported", "weakly_supported", "unsupported"]);
export type SemanticVerificationClaimStrength = z.infer<typeof semanticVerificationClaimStrengthSchema>;

export const semanticVerificationTemporalTenseSchema = z.enum(["current", "past", "future", "unclear"]);
export type SemanticVerificationTemporalTense = z.infer<typeof semanticVerificationTemporalTenseSchema>;

export const semanticVerificationResultSchema = z.object({
  version: z.literal(SEMANTIC_VERIFICATION_VERSION),
  supported: z.boolean(),
  intent_type: semanticVerificationIntentTypeSchema,
  authorial_stance: semanticVerificationAuthorialStanceSchema,
  target_type: semanticVerificationTargetTypeSchema,
  target_name: z.string().trim().max(160).nullable(),
  claim_strength: semanticVerificationClaimStrengthSchema,
  evidence_spans: z.array(z.object({ text: z.string().trim().min(1).max(500), confidence: z.number().min(0).max(1) })).max(8),
  temporal_tense: semanticVerificationTemporalTenseSchema,
});
export type SemanticVerificationResult = z.infer<typeof semanticVerificationResultSchema>;

const PRIMARY_INTENT_TO_VERIFICATION_INTENT: Record<SignalQualificationPrimaryIntent, SemanticVerificationIntentType> = {
  switching_intent: "switching",
  alternative_search: "alternative_search",
  recommendation_request: "recommendation",
  purchase_research: "purchase",
  problem_solution_search: "pain",
  feature_requirement: "feature_request",
  comparison_intent: "comparison",
  vendor_evaluation: "purchase",
  renewal_reconsideration: "switching",
  explicit_pain: "pain",
  unmet_need: "pain",
  unknown: "none",
};

const WILLINGNESS_TO_PAY_PATTERN = /\b(?:willing to pay|worth paying for|i(?:'d| would)(?: happily| gladly)? pay|we(?:'d| would)(?: happily| gladly)? pay)\b/i;

export function detectWillingnessToPay(text: string): boolean {
  return WILLINGNESS_TO_PAY_PATTERN.test(text);
}

const PAST_TENSE_MARKERS = /\b(?:moved|switched|left|migrated|replaced|adopted|dropped|cancell?ed|churned|i(?:'ve| have) used|we(?:'ve| have) used)\b/i;
const FUTURE_TENSE_MARKERS = /\b(?:will switch|will move|going to switch|going to move|planning to|plan to|next quarter|next year)\b/i;
const PRESENT_TENSE_MARKERS = /\b(?:considering|evaluating|looking for|switching|moving|migrating|thinking about)\b/i;

/** A light deterministic heuristic over source text, not a model output field - documented as such. */
export function classifyTemporalTense(text: string): SemanticVerificationTemporalTense {
  if (FUTURE_TENSE_MARKERS.test(text)) return "future";
  if (PAST_TENSE_MARKERS.test(text) && !PRESENT_TENSE_MARKERS.test(text)) return "past";
  if (PRESENT_TENSE_MARKERS.test(text)) return "current";
  return "unclear";
}

function authorialStanceLabel(reasoning: ConversationMarketReasoning): SemanticVerificationAuthorialStance {
  if (reasoning.authorial_stance === "vendor_marketing") return "vendor_marketing";
  if (reasoning.authorial_stance === "third_party_technical_discussion") return reasoning.buyer_context || reasoning.commercial_intent ? "unknown" : "technical_discussion";
  if (reasoning.actor_type === "buyer") {
    if (reasoning.commercial_intent) return "first_party_demand";
    if (reasoning.first_party_experience) return "first_party_experience";
    return "recommendation";
  }
  if (!reasoning.first_party_experience && !reasoning.buyer_context) return "descriptive_reference";
  return "unknown";
}

function targetTypeLabel(reasoning: ConversationMarketReasoning): SemanticVerificationTargetType {
  if (reasoning.demand_target_type === "scanned_product") return "tracked_product";
  if (reasoning.demand_target_type === "third_party_product") return "competitor";
  if (reasoning.demand_target_type === "category") return "category";
  if (reasoning.demand_target_type === "implementation") return "workflow";
  return reasoning.demand_target ? "ambiguous" : "none";
}

function claimStrength(reasoning: ConversationMarketReasoning): SemanticVerificationClaimStrength {
  if (!reasoning.evidence_spans.length) return "unsupported";
  if (reasoning.confidence >= 0.75) return "explicit";
  if (reasoning.confidence >= 0.5) return "strongly_supported";
  return "weakly_supported";
}

/**
 * Projects the already-validated ConversationMarketReasoning (post
 * validateShadowReasoningEvidence + mergeValidatedShadowReasoning, both
 * unchanged) into the structured verification contract a materialization
 * decision can consume directly. This is NOT a second LLM call or a parallel
 * provider stack - it is a pure, deterministic mapping over an existing
 * verified artifact.
 */
export function deriveSemanticVerificationResult(input: { merged: ConversationMarketReasoning; droppedClaims: string[]; primaryIntent: SignalQualificationPrimaryIntent; sourceText: string }): SemanticVerificationResult {
  const willingnessToPay = detectWillingnessToPay(input.sourceText);
  return semanticVerificationResultSchema.parse({
    version: SEMANTIC_VERIFICATION_VERSION,
    supported: input.droppedClaims.length === 0,
    intent_type: willingnessToPay ? "willingness_to_pay" : PRIMARY_INTENT_TO_VERIFICATION_INTENT[input.primaryIntent],
    authorial_stance: authorialStanceLabel(input.merged),
    target_type: targetTypeLabel(input.merged),
    target_name: input.merged.demand_target,
    claim_strength: claimStrength(input.merged),
    evidence_spans: input.merged.evidence_spans,
    temporal_tense: classifyTemporalTense(input.sourceText),
  });
}
