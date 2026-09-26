import { describe, expect, it } from "vitest";

import { classifyTemporalTense, deriveSemanticVerificationResult, detectWillingnessToPay, SEMANTIC_VERIFICATION_VERSION } from "../../src/server/modules/intelligence/semantic-verification.schemas";
import type { ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";

function reasoning(overrides: Partial<ConversationMarketReasoning> = {}): ConversationMarketReasoning {
  return {
    version: "conversation_market_reasoning_v2",
    actor_type: "buyer",
    actor_confidence: 0.9,
    buyer_context: true,
    buyer_context_confidence: 0.9,
    current_solution: "Jira",
    pain_summary: "too slow",
    requested_outcome: null,
    demand_target_type: "scanned_product",
    demand_target: "Linear",
    source_products: ["Jira"],
    destination_products: ["Linear"],
    mentioned_products: [{ name: "Jira", role: "source", confidence: 0.9 }, { name: "Linear", role: "destination", confidence: 0.9 }],
    direction_relative_to_scanned_product: "toward_product",
    category_or_job_demand: false,
    commercial_intent: true,
    first_party_experience: true,
    implementation_only: false,
    promotional_content: false,
    confidence: 0.9,
    evidence_spans: [{ text: "we moved from Jira to Linear", confidence: 0.9 }],
    short_user_facing_summary: "s",
    short_user_facing_why: "w",
    relationship_candidates: [],
    authorial_stance: "buyer",
    ...overrides,
  };
}

describe("semantic verification result (semantic_verification_v1)", () => {
  it("is versioned", () => {
    expect(SEMANTIC_VERIFICATION_VERSION).toBe("semantic_verification_v1");
  });

  it("detects an explicit willingness-to-pay phrase", () => {
    expect(detectWillingnessToPay("I'd happily pay for this.")).toBe(true);
    expect(detectWillingnessToPay("This is worth paying for.")).toBe(true);
    expect(detectWillingnessToPay("I like this tool.")).toBe(false);
  });

  it("classifies past tense from historical verbs, present from ongoing-consideration language, future from explicit plans", () => {
    expect(classifyTemporalTense("We moved from Jira to Linear last year.")).toBe("past");
    expect(classifyTemporalTense("We are considering switching from Jira.")).toBe("current");
    expect(classifyTemporalTense("We are planning to switch next quarter.")).toBe("future");
    expect(classifyTemporalTense("Interesting tool.")).toBe("unclear");
  });

  it("marks supported=true only when no relevant claim was dropped", () => {
    const supported = deriveSemanticVerificationResult({ merged: reasoning(), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "we moved from Jira to Linear" });
    expect(supported.supported).toBe(true);
    const unsupported = deriveSemanticVerificationResult({ merged: reasoning(), droppedClaims: ["direction_relative_to_scanned_product"], primaryIntent: "switching_intent", sourceText: "we moved from Jira to Linear" });
    expect(unsupported.supported).toBe(false);
  });

  it("maps primary intent to the coarser verification intent enum, with willingness-to-pay taking precedence", () => {
    expect(deriveSemanticVerificationResult({ merged: reasoning(), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "we moved from Jira to Linear" }).intent_type).toBe("switching");
    expect(deriveSemanticVerificationResult({ merged: reasoning(), droppedClaims: [], primaryIntent: "purchase_research", sourceText: "we are buying a new CRM" }).intent_type).toBe("purchase");
    expect(deriveSemanticVerificationResult({ merged: reasoning(), droppedClaims: [], primaryIntent: "explicit_pain", sourceText: "I would happily pay for this" }).intent_type).toBe("willingness_to_pay");
  });

  it("maps authorial stance: vendor pitch, technical discussion, first-party demand, and recommendation are distinguished", () => {
    expect(deriveSemanticVerificationResult({ merged: reasoning({ authorial_stance: "vendor_marketing" }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "we launched an alternative" }).authorial_stance).toBe("vendor_marketing");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ authorial_stance: "third_party_technical_discussion", buyer_context: false, commercial_intent: false }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "the team migrated their tracker" }).authorial_stance).toBe("technical_discussion");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ actor_type: "buyer", commercial_intent: true }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "we need this" }).authorial_stance).toBe("first_party_demand");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ actor_type: "buyer", commercial_intent: false, first_party_experience: false }), droppedClaims: [], primaryIntent: "recommendation_request", sourceText: "what do you recommend" }).authorial_stance).toBe("recommendation");
  });

  it("maps target type from demand_target_type", () => {
    expect(deriveSemanticVerificationResult({ merged: reasoning({ demand_target_type: "third_party_product" }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).target_type).toBe("competitor");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ demand_target_type: "category" }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).target_type).toBe("category");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ demand_target_type: "implementation" }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).target_type).toBe("workflow");
  });

  it("derives claim strength from confidence and evidence presence", () => {
    expect(deriveSemanticVerificationResult({ merged: reasoning({ confidence: 0.9 }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).claim_strength).toBe("explicit");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ confidence: 0.6 }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).claim_strength).toBe("strongly_supported");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ confidence: 0.3 }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).claim_strength).toBe("weakly_supported");
    expect(deriveSemanticVerificationResult({ merged: reasoning({ evidence_spans: [] }), droppedClaims: [], primaryIntent: "switching_intent", sourceText: "x" }).claim_strength).toBe("unsupported");
  });

  it("is a pure function of its inputs", () => {
    const input = { merged: reasoning(), droppedClaims: [], primaryIntent: "switching_intent" as const, sourceText: "we moved from Jira to Linear" };
    expect(deriveSemanticVerificationResult(input)).toEqual(deriveSemanticVerificationResult(input));
  });
});
