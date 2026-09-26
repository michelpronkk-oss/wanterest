import { createHash } from "node:crypto";

import type { ConversationMarketReasoning } from "./signal-qualification.schemas";

export const SEMANTIC_REASONING_ROUTER_VERSION = "semantic_reasoning_router_v2" as const;
export const SEMANTIC_REASONING_PROMPT_VERSION = "semantic_reasoning_prompt_v1" as const;
export type SemanticReasoningRoute = "deterministic_only" | "reject_without_llm" | "llm_reasoning";
export type SemanticReasoningUncertaintyReason = "obvious_noise" | "implementation_safeguard" | "explicit_direction" | "ambiguous_direction" | "unclear_buyer_context" | "unknown_product_entity" | "conflicting_semantic_evidence";

/**
 * 12A.3A.1 amendment (materialization_safety_gate_v1): a bounded, named set of
 * high-risk claim types that must be either deterministically low-risk or
 * verified before they can materialize, regardless of how confident the
 * deterministic pass is. See docs/architecture.md's "12A.3A.1 Amendment"
 * section for the exact contract each reason represents.
 */
export type MaterializationSafetyReason = "high_risk_switching_claim" | "high_risk_competitor_claim" | "high_risk_purchase_claim" | "high_risk_wtp_claim" | "high_risk_migration_claim" | "high_risk_urgency_claim" | "ambiguous_entity_claim" | "ambiguous_author_stance";

export type SemanticReasoningReason = SemanticReasoningUncertaintyReason | MaterializationSafetyReason;

/**
 * v2 (materially changed from v1, truthfully re-versioned): gains an optional
 * materializationRisk input. A non-empty value forces llm_reasoning at top
 * priority - overriding the confidence>=0.75 "explicit_direction" fast path
 * that previously let a confident-but-high-risk claim through untouched -
 * unless the content is obvious noise/promotional (still rejected outright,
 * never worth a call) or implementation_only (definitionally not a
 * materializable claim). Every other input/behavior is unchanged from v1: a
 * caller that never passes materializationRisk sees identical routing.
 */
export function routeSemanticReasoning(input: { deterministic: ConversationMarketReasoning; text: string; relevance: number; noise: number; materializationRisk?: MaterializationSafetyReason[] }): { route: SemanticReasoningRoute; reasons: SemanticReasoningReason[]; priority: number } {
  const value = input.text.trim();
  if (!value || value.length < 24 || input.noise >= 0.75 || input.deterministic.promotional_content) return { route: "reject_without_llm", reasons: ["obvious_noise"], priority: 0 };
  if (input.deterministic.implementation_only) return { route: "deterministic_only", reasons: ["implementation_safeguard"], priority: 0 };
  if (input.materializationRisk?.length) return { route: "llm_reasoning", reasons: input.materializationRisk, priority: 2 };
  if (input.deterministic.direction_relative_to_scanned_product !== "unknown" && input.deterministic.confidence >= 0.75) return { route: "deterministic_only", reasons: ["explicit_direction"], priority: 0 };
  const reasons: SemanticReasoningUncertaintyReason[] = [];
  if (input.deterministic.direction_relative_to_scanned_product === "unknown") reasons.push("ambiguous_direction");
  if (!input.deterministic.buyer_context) reasons.push("unclear_buyer_context");
  if (input.deterministic.mentioned_products.some((item) => item.confidence < 0.5)) reasons.push("unknown_product_entity");
  if (!reasons.length || input.relevance < 0.35) return { route: "deterministic_only", reasons: [], priority: 0 };
  return { route: "llm_reasoning", reasons, priority: Number((input.relevance * 0.5 + (1 - input.deterministic.confidence) * 0.5).toFixed(3)) };
}

export function semanticReasoningFingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function appearsInSource(value: string | null, text: string): boolean {
  if (!value?.trim()) return true;
  const words = normalized(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  return normalized(text).includes(normalized(value)) || (words.length > 0 && words.filter((word) => normalized(text).includes(word)).length >= Math.min(2, words.length));
}

function hasDirectionalEvidence(text: string): boolean {
  return /\b(?:switch(?:ing|ed)?|migrat(?:e|ing|ed)|mov(?:e|ing|ed)|replac(?:e|ing|ed)|alternatives?|instead|versus|vs\.?|leave|leaving|from|to)\b/iu.test(text);
}

export function validateShadowReasoningEvidence(input: { reasoning: ConversationMarketReasoning; sourceText: string }): { reasoning: ConversationMarketReasoning | null; droppedClaims: string[] } {
  const source = normalized(input.sourceText);
  const evidence = input.reasoning.evidence_spans.filter((span) => source.includes(normalized(span.text)));
  if (!evidence.length) return { reasoning: null, droppedClaims: ["evidence_spans"] };
  const droppedClaims: string[] = [];
  const mentionedProducts = input.reasoning.mentioned_products.filter((product) => appearsInSource(product.name, input.sourceText));
  if (mentionedProducts.length !== input.reasoning.mentioned_products.length) droppedClaims.push("mentioned_products");
  const sourceProducts = input.reasoning.source_products.filter((product) => appearsInSource(product, input.sourceText));
  if (sourceProducts.length !== input.reasoning.source_products.length) droppedClaims.push("source_products");
  const destinationProducts = input.reasoning.destination_products.filter((product) => appearsInSource(product, input.sourceText));
  if (destinationProducts.length !== input.reasoning.destination_products.length) droppedClaims.push("destination_products");
  const currentSolution = appearsInSource(input.reasoning.current_solution, input.sourceText) ? input.reasoning.current_solution : null;
  if (currentSolution !== input.reasoning.current_solution) droppedClaims.push("current_solution");
  const demandTarget = appearsInSource(input.reasoning.demand_target, input.sourceText) ? input.reasoning.demand_target : null;
  if (demandTarget !== input.reasoning.demand_target) droppedClaims.push("demand_target");
  const painSummary = appearsInSource(input.reasoning.pain_summary, input.sourceText) ? input.reasoning.pain_summary : null;
  if (painSummary !== input.reasoning.pain_summary) droppedClaims.push("pain_summary");
  const requestedOutcome = appearsInSource(input.reasoning.requested_outcome, input.sourceText) ? input.reasoning.requested_outcome : null;
  if (requestedOutcome !== input.reasoning.requested_outcome) droppedClaims.push("requested_outcome");
  const direction = input.reasoning.direction_relative_to_scanned_product !== "unknown" && !hasDirectionalEvidence(input.sourceText)
    ? "unknown"
    : input.reasoning.direction_relative_to_scanned_product;
  if (direction !== input.reasoning.direction_relative_to_scanned_product) droppedClaims.push("direction_relative_to_scanned_product");
  const buyerContext = input.reasoning.buyer_context && !/\b(?:i|we|my|our|us)\b/iu.test(input.sourceText) ? false : input.reasoning.buyer_context;
  if (buyerContext !== input.reasoning.buyer_context) droppedClaims.push("buyer_context");
  return {
    reasoning: {
      ...input.reasoning,
      source_products: sourceProducts,
      destination_products: destinationProducts,
      mentioned_products: mentionedProducts,
      current_solution: currentSolution,
      demand_target: demandTarget,
      pain_summary: painSummary,
      requested_outcome: requestedOutcome,
      direction_relative_to_scanned_product: direction,
      buyer_context: buyerContext,
      buyer_context_confidence: buyerContext ? input.reasoning.buyer_context_confidence : 0,
      commercial_intent: buyerContext ? input.reasoning.commercial_intent : false,
      evidence_spans: evidence,
    },
    droppedClaims,
  };
}

export function mergeValidatedShadowReasoning(input: { deterministic: ConversationMarketReasoning; validated: ConversationMarketReasoning }): { merged: ConversationMarketReasoning; conflictBlocked: boolean } {
  const strongImplementation = input.deterministic.implementation_only;
  const strongDirection = input.deterministic.direction_relative_to_scanned_product !== "unknown" && input.deterministic.confidence >= 0.75;
  if (strongImplementation) return { merged: input.deterministic, conflictBlocked: JSON.stringify(input.deterministic) !== JSON.stringify(input.validated) };
  const merged = { ...input.deterministic, ...input.validated, version: "conversation_market_reasoning_v2" };
  if (strongDirection && input.validated.direction_relative_to_scanned_product !== input.deterministic.direction_relative_to_scanned_product) {
    return { merged: { ...merged, direction_relative_to_scanned_product: input.deterministic.direction_relative_to_scanned_product }, conflictBlocked: true };
  }
  return { merged, conflictBlocked: false };
}
