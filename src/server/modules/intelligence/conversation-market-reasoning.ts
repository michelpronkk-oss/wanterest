import { conversationMarketReasoningSchema, type ConversationMarketReasoning } from "./signal-qualification.schemas";
import type { MarketContext } from "./market-context";
import type { DirectionalDemand } from "./directional-demand";

export const CONVERSATION_MARKET_REASONING_VERSION = "conversation_market_reasoning_v1" as const;

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sentence(value: string): string {
  return text(value).split(/(?<=[.!?])\s+/u)[0]?.slice(0, 300) || "Conversation context is unknown.";
}

function mention(name: string, role: "source" | "destination" | "host" | "competitor_reference" | "implementation_context" | "mentioned", confidence: number) {
  return { name, role, confidence };
}

export function buildConversationMarketReasoning(input: {
  productName: string;
  context: MarketContext;
  demand: DirectionalDemand;
  title: string | null | undefined;
  body: string;
  analysis: { pain_themes: unknown; desired_outcomes: unknown; buyer_language: unknown; confidence: number };
}): ConversationMarketReasoning {
  const sourceText = text(`${input.title ?? ""} ${input.body}`);
  const pains = Array.isArray(input.analysis.pain_themes) ? input.analysis.pain_themes.filter((value): value is string => typeof value === "string") : [];
  const outcomes = Array.isArray(input.analysis.desired_outcomes) ? input.analysis.desired_outcomes.filter((value): value is string => typeof value === "string") : [];
  const buyerLanguage = Array.isArray(input.analysis.buyer_language) ? input.analysis.buyer_language.filter((value): value is string => typeof value === "string") : [];
  const firstParty = /\b(?:i|we|our|my|us)\b/i.test(sourceText);
  const promotional = /\b(?:sign up|free demo|affiliate|referral code|sponsored|limited offer|discount code)\b/i.test(sourceText);
  const destinations = input.demand.demand_target_name && input.demand.demand_direction !== "contextual" ? [input.demand.demand_target_name] : [];
  const mentioned = [
    ...input.demand.source_products.map((name) => mention(name, input.demand.demand_target_type === "implementation" ? "implementation_context" : "source", 0.82)),
    ...(input.demand.demand_target_name ? [mention(input.demand.demand_target_name, input.demand.host_product_context ? "host" : input.demand.demand_target_type === "implementation" ? "implementation_context" : "destination", input.demand.demand_direction === "unknown" ? 0.35 : 0.82)] : []),
  ];
  if (!mentioned.some((item) => item.name.toLowerCase() === input.productName.toLowerCase()) && new RegExp(`(^|[^A-Za-z0-9])${input.productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-z0-9])`, "i").test(sourceText)) mentioned.push(mention(input.productName, "mentioned", 0.6));
  const relationshipCandidates = input.demand.demand_target_type === "third_party_product" && input.demand.demand_target_name && !input.context.relationships.some((item) => item.entity_name.toLowerCase() === input.demand.demand_target_name?.toLowerCase())
    ? [{ entity_name: input.demand.demand_target_name, relationship_type: input.demand.demand_direction === "away_from_product" ? "direct_competitor" as const : "adjacent_product" as const, confidence: input.demand.demand_direction === "away_from_product" ? 0.7 : 0.5, evidence_count: 1 }]
    : [];
  const sourceNames = input.demand.source_products.join(", ");
  const target = input.demand.demand_target_name;
  const summary = input.demand.demand_direction === "toward_product" ? `Conversation is evaluating ${input.productName} as the desired product.`
    : input.demand.demand_direction === "away_from_product" ? `Conversation is moving from ${sourceNames || input.productName} to ${target ?? "another product"}.`
    : input.demand.host_product_context ? `Conversation evaluates ${target ?? "the host project"} against ${sourceNames || "another product"}.`
    : input.demand.demand_target_type === "implementation" ? "Conversation is about an implementation or authentication request."
    : input.demand.demand_target_type === "category" ? `Conversation is seeking a ${target ?? "category"} alternative.`
    : sentence(sourceText);
  return conversationMarketReasoningSchema.parse({
    version: CONVERSATION_MARKET_REASONING_VERSION,
    actor_type: input.demand.speaker_role,
    actor_confidence: input.demand.speaker_role === "unknown" ? 0.2 : input.demand.speaker_role === "maintainer" ? 0.9 : 0.7,
    buyer_context: buyerLanguage.length > 0 || firstParty,
    buyer_context_confidence: buyerLanguage.length ? 0.75 : firstParty ? 0.5 : 0.15,
    current_solution: input.demand.source_products[0] ?? null,
    pain_summary: pains[0] ?? null,
    requested_outcome: outcomes[0] ?? null,
    demand_target_type: input.demand.demand_target_type,
    demand_target: target,
    source_products: input.demand.source_products,
    destination_products: destinations,
    mentioned_products: mentioned,
    direction_relative_to_scanned_product: input.demand.demand_direction,
    category_or_job_demand: input.demand.demand_target_type === "category",
    commercial_intent: buyerLanguage.length > 0 && !promotional,
    first_party_experience: firstParty,
    implementation_only: input.demand.demand_target_type === "implementation",
    promotional_content: promotional,
    confidence: Math.max(0, Math.min(1, input.analysis.confidence * (input.demand.demand_direction === "unknown" ? 0.6 : 0.9))),
    evidence_spans: sourceText ? [{ text: sentence(sourceText), confidence: input.demand.demand_direction === "unknown" ? 0.35 : 0.8 }] : [],
    short_user_facing_summary: summary,
    short_user_facing_why: summary,
    relationship_candidates: relationshipCandidates,
  });
}
