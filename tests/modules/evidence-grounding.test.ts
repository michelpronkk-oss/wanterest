import { describe, expect, it } from "vitest";

import { EVIDENCE_GROUNDING_VERSION, EVIDENCE_HISTORICAL_THRESHOLD_DAYS, groundDeterministicReasoning, temporalGroundingClause } from "../../src/server/modules/intelligence/evidence-grounding";
import type { ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";

function reasoning(overrides: Partial<ConversationMarketReasoning> = {}): ConversationMarketReasoning {
  return {
    version: "conversation_market_reasoning_v1",
    actor_type: "unknown",
    actor_confidence: 0.4,
    buyer_context: true,
    buyer_context_confidence: 0.5,
    current_solution: "Jira",
    pain_summary: "Jira is slow",
    requested_outcome: null,
    demand_target_type: "third_party_product",
    demand_target: "Orbit",
    source_products: ["Jira"],
    destination_products: [],
    mentioned_products: [{ name: "Orbit", role: "destination", confidence: 0.3 }],
    direction_relative_to_scanned_product: "away_from_product",
    category_or_job_demand: false,
    commercial_intent: true,
    first_party_experience: true,
    implementation_only: false,
    promotional_content: false,
    confidence: 0.5,
    evidence_spans: [{ text: "we are moving away from Jira", confidence: 0.6 }],
    short_user_facing_summary: "Ambiguous market interpretation.",
    short_user_facing_why: "Direction is unclear.",
    relationship_candidates: [],
    authorial_stance: "unknown",
    ...overrides,
  };
}

describe("evidence grounding gate (evidence_grounding_v1)", () => {
  it("is versioned", () => {
    expect(EVIDENCE_GROUNDING_VERSION).toBe("evidence_grounding_v1");
  });

  it("does not require verification or downgrade anything for a confident, unambiguous direction", () => {
    const confident = reasoning({ direction_relative_to_scanned_product: "toward_product", confidence: 0.9, mentioned_products: [{ name: "Linear", role: "destination", confidence: 0.9 }] });
    const result = groundDeterministicReasoning({ reasoning: confident, text: "we switched to Linear", relevance: 0.8, noise: 0.1 });
    expect(result.gate.verificationRequired).toBe(false);
    expect(result.gate.downgradedClaimTypes).toEqual([]);
    expect(result.reasoning).toBe(confident);
  });

  it("does not require verification for obvious noise/promotional content (reject_without_llm route)", () => {
    const noisy = reasoning({ promotional_content: true });
    const result = groundDeterministicReasoning({ reasoning: noisy, text: "sign up now for a free demo", relevance: 0.9, noise: 0.9 });
    expect(result.gate.verificationRequired).toBe(false);
    expect(result.gate.downgradedClaimTypes).toEqual([]);
  });

  it("requires verification for an already-ambiguous direction, with nothing further to downgrade (it is already at its safe default)", () => {
    const ambiguous = reasoning({ direction_relative_to_scanned_product: "unknown", confidence: 0.4, buyer_context: true, mentioned_products: [{ name: "Orbit", role: "destination", confidence: 0.9 }] });
    const result = groundDeterministicReasoning({ reasoning: ambiguous, text: "We are moving away from Jira, maybe to Orbit or something else entirely - not fully decided yet.", relevance: 0.6, noise: 0.1 });
    expect(result.gate.verificationRequired).toBe(true);
    expect(result.gate.reasons).toContain("ambiguous_direction");
    expect(result.reasoning.direction_relative_to_scanned_product).toBe("unknown");
  });

  it("requires verification when the router flags unclear buyer context, leaving the already-conservative buyer_context=false untouched", () => {
    const conservative = reasoning({ direction_relative_to_scanned_product: "unknown", buyer_context: false, buyer_context_confidence: 0, commercial_intent: false, mentioned_products: [{ name: "Orbit", role: "destination", confidence: 0.9 }] });
    const result = groundDeterministicReasoning({ reasoning: conservative, text: "This project seems interesting but the direction here is unclear either way.", relevance: 0.6, noise: 0.1 });
    expect(result.gate.verificationRequired).toBe(true);
    expect(result.gate.reasons).toContain("unclear_buyer_context");
    expect(result.reasoning.buyer_context).toBe(false);
  });

  it("drops low-confidence mentioned products when the router flags an unknown product entity", () => {
    const ambiguous = reasoning({ direction_relative_to_scanned_product: "unknown", buyer_context: false, mentioned_products: [{ name: "Orbit", role: "destination", confidence: 0.2 }, { name: "Jira", role: "source", confidence: 0.9 }] });
    const result = groundDeterministicReasoning({ reasoning: ambiguous, text: "This is a genuinely ambiguous mention of a low-confidence product name here.", relevance: 0.6, noise: 0.1 });
    expect(result.gate.downgradedClaimTypes).toContain("mentioned_product_identity");
    expect(result.reasoning.mentioned_products.map((product) => product.name)).toEqual(["Jira"]);
  });

  it("never fails/throws when downgrading - it always returns a valid reasoning object", () => {
    const ambiguous = reasoning({ direction_relative_to_scanned_product: "unknown", buyer_context: true });
    expect(() => groundDeterministicReasoning({ reasoning: ambiguous, text: "Ambiguous text with no clear direction at all here.", relevance: 0.6, noise: 0.1 })).not.toThrow();
  });

  it("is a pure function of its inputs (replay-safe/idempotent)", () => {
    const ambiguous = reasoning({ direction_relative_to_scanned_product: "away_from_product", confidence: 0.3 });
    const input = { reasoning: ambiguous, text: "Ambiguous direction text without a clear resolution either way.", relevance: 0.5, noise: 0.2 };
    expect(groundDeterministicReasoning(input)).toEqual(groundDeterministicReasoning(input));
  });
});

describe("temporal grounding clause (minimum-safe temporal fix)", () => {
  it("returns nothing when there is no published date", () => {
    expect(temporalGroundingClause(null, new Date("2026-09-26T00:00:00.000Z"))).toBe("");
  });

  it("states the literal published date for recent content without a currency qualifier", () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    const clause = temporalGroundingClause("2026-09-01T00:00:00.000Z", now);
    expect(clause).toContain("2026-09-01");
    expect(clause).not.toMatch(/may not reflect current demand/);
  });

  it("adds an explicit non-currency qualifier past the historical threshold", () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    const oldDate = new Date(now.getTime() - (EVIDENCE_HISTORICAL_THRESHOLD_DAYS + 1) * 86_400_000).toISOString();
    const clause = temporalGroundingClause(oldDate, now);
    expect(clause).toMatch(/may not reflect current demand/);
  });
});
