import { describe, expect, it } from "vitest";

import { routeSemanticReasoning, SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";
import type { ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";

function reasoning(overrides: Partial<ConversationMarketReasoning> = {}): ConversationMarketReasoning {
  return {
    version: "conversation_market_reasoning_v1",
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
    evidence_spans: [{ text: "we switched to Linear", confidence: 0.9 }],
    short_user_facing_summary: "s",
    short_user_facing_why: "w",
    relationship_candidates: [],
    authorial_stance: "buyer",
    ...overrides,
  };
}

describe("semantic_reasoning_router_v2 (12A.3A.1 amendment)", () => {
  it("is truthfully versioned as v2", () => {
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v2");
  });

  it("without materializationRisk, behaves exactly like v1: a confident direction still takes the deterministic_only fast path", () => {
    const decision = routeSemanticReasoning({ deterministic: reasoning(), text: "we switched to Linear because Jira was too slow for our team", relevance: 0.8, noise: 0.1 });
    expect(decision).toMatchObject({ route: "deterministic_only", reasons: ["explicit_direction"] });
  });

  it("materializationRisk overrides the confident fast path: a high-risk claim always routes to llm_reasoning at top priority", () => {
    const decision = routeSemanticReasoning({ deterministic: reasoning(), text: "we switched to Linear because Jira was too slow for our team", relevance: 0.8, noise: 0.1, materializationRisk: ["high_risk_switching_claim"] });
    expect(decision.route).toBe("llm_reasoning");
    expect(decision.reasons).toEqual(["high_risk_switching_claim"]);
    expect(decision.priority).toBe(2);
  });

  it("materializationRisk still yields to obvious noise/promotional content - never worth a call", () => {
    const decision = routeSemanticReasoning({ deterministic: reasoning({ promotional_content: true }), text: "sign up now for a free demo of our switching tool", relevance: 0.8, noise: 0.9, materializationRisk: ["high_risk_switching_claim"] });
    expect(decision.route).toBe("reject_without_llm");
  });

  it("materializationRisk still yields to implementation_only - definitionally not a materializable claim", () => {
    const decision = routeSemanticReasoning({ deterministic: reasoning({ implementation_only: true }), text: "we need an alternative SSO configuration for our internal tooling", relevance: 0.8, noise: 0.1, materializationRisk: ["high_risk_switching_claim"] });
    expect(decision.route).toBe("deterministic_only");
    expect(decision.reasons).toEqual(["implementation_safeguard"]);
  });

  it("an empty materializationRisk array behaves like no materializationRisk at all", () => {
    const withEmpty = routeSemanticReasoning({ deterministic: reasoning(), text: "we switched to Linear because Jira was too slow for our team", relevance: 0.8, noise: 0.1, materializationRisk: [] });
    const withoutField = routeSemanticReasoning({ deterministic: reasoning(), text: "we switched to Linear because Jira was too slow for our team", relevance: 0.8, noise: 0.1 });
    expect(withEmpty).toEqual(withoutField);
  });

  it("existing uncertainty-only routing is unchanged: an ambiguous direction with low relevance stays deterministic_only", () => {
    const ambiguous = reasoning({ direction_relative_to_scanned_product: "unknown", confidence: 0.3 });
    const decision = routeSemanticReasoning({ deterministic: ambiguous, text: "this could go either way honestly, hard to tell", relevance: 0.1, noise: 0.1 });
    expect(decision.route).toBe("deterministic_only");
  });

  it("is a pure function of its inputs", () => {
    const input = { deterministic: reasoning(), text: "we switched to Linear because Jira was too slow for our team", relevance: 0.8, noise: 0.1, materializationRisk: ["high_risk_wtp_claim"] as const };
    expect(routeSemanticReasoning({ ...input, materializationRisk: [...input.materializationRisk] })).toEqual(routeSemanticReasoning({ ...input, materializationRisk: [...input.materializationRisk] }));
  });
});
