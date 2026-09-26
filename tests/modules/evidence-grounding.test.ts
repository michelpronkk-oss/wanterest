import { describe, expect, it } from "vitest";

import { assessMaterializationRisk, EVIDENCE_GROUNDING_VERSION, EVIDENCE_HISTORICAL_THRESHOLD_DAYS, evidenceFidelityGroundingEnabled, groundDeterministicReasoning, MATERIALIZATION_SAFETY_GATE_VERSION, temporalGroundingClause } from "../../src/server/modules/intelligence/evidence-grounding";
import type { ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";
import type { DirectionalDemand } from "../../src/server/modules/intelligence/directional-demand";

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

function demand(overrides: Partial<DirectionalDemand> = {}): DirectionalDemand {
  return {
    demand_direction: "unknown",
    demand_target_type: "unknown",
    demand_target_name: null,
    source_products: [],
    speaker_role: "unknown",
    positive_for_product: null,
    host_product_context: false,
    authorial_stance: "unknown",
    ...overrides,
  };
}

describe("materialization risk assessment (materialization_safety_gate_v1)", () => {
  it("is versioned", () => {
    expect(MATERIALIZATION_SAFETY_GATE_VERSION).toBe("materialization_safety_gate_v1");
  });

  it("flags high_risk_switching_claim for a switching_intent candidate", () => {
    expect(assessMaterializationRisk({ primaryIntent: "switching_intent", demand: demand(), urgency: null, text: "we switched", mentionedProducts: [] })).toContain("high_risk_switching_claim");
  });

  it("flags high_risk_competitor_claim when a specific competitor is named as a third-party/category target", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ source_products: ["Jira"], demand_target_type: "third_party_product" }), urgency: null, text: "x", mentionedProducts: [] })).toContain("high_risk_competitor_claim");
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ source_products: ["Jira"], demand_target_type: "category" }), urgency: null, text: "x", mentionedProducts: [] })).toContain("high_risk_competitor_claim");
  });

  it("does not flag high_risk_competitor_claim when the target is the scanned product itself", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ source_products: ["Jira"], demand_target_type: "scanned_product" }), urgency: null, text: "x", mentionedProducts: [] })).not.toContain("high_risk_competitor_claim");
  });

  it("flags high_risk_purchase_claim for purchase_research and vendor_evaluation", () => {
    expect(assessMaterializationRisk({ primaryIntent: "purchase_research", demand: demand(), urgency: null, text: "x", mentionedProducts: [] })).toContain("high_risk_purchase_claim");
    expect(assessMaterializationRisk({ primaryIntent: "vendor_evaluation", demand: demand(), urgency: null, text: "x", mentionedProducts: [] })).toContain("high_risk_purchase_claim");
  });

  it("flags high_risk_wtp_claim for an explicit willingness-to-pay phrase", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: null, text: "I would happily pay for this.", mentionedProducts: [] })).toContain("high_risk_wtp_claim");
  });

  it("flags high_risk_migration_claim for a genuine away-from-product migration with a named source", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ demand_direction: "away_from_product", source_products: ["Jira"] }), urgency: null, text: "x", mentionedProducts: [] })).toContain("high_risk_migration_claim");
  });

  it("flags high_risk_urgency_claim only at or above the urgency threshold", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: 0.7, text: "x", mentionedProducts: [] })).toContain("high_risk_urgency_claim");
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: 0.5, text: "x", mentionedProducts: [] })).not.toContain("high_risk_urgency_claim");
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: null, text: "x", mentionedProducts: [] })).not.toContain("high_risk_urgency_claim");
  });

  it("flags ambiguous_entity_claim for a low-confidence mentioned product", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: null, text: "x", mentionedProducts: [{ name: "Orbit", role: "destination", confidence: 0.3 }] })).toContain("ambiguous_entity_claim");
  });

  it("flags ambiguous_author_stance when speaker_role and authorial_stance disagree", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ speaker_role: "buyer", authorial_stance: "vendor_marketing" }), urgency: null, text: "x", mentionedProducts: [] })).toContain("ambiguous_author_stance");
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand({ speaker_role: "buyer", authorial_stance: "buyer" }), urgency: null, text: "x", mentionedProducts: [] })).not.toContain("ambiguous_author_stance");
  });

  it("returns no reasons for a genuinely low-risk candidate", () => {
    expect(assessMaterializationRisk({ primaryIntent: "explicit_pain", demand: demand(), urgency: null, text: "our workflow is slow and manual", mentionedProducts: [] })).toEqual([]);
  });

  it("deduplicates reasons and is a pure function of its inputs", () => {
    const input = { primaryIntent: "switching_intent" as const, demand: demand({ source_products: ["Jira"], demand_target_type: "third_party_product" as const }), urgency: null, text: "x", mentionedProducts: [] };
    const result = assessMaterializationRisk(input);
    expect(new Set(result).size).toBe(result.length);
    expect(assessMaterializationRisk(input)).toEqual(assessMaterializationRisk(input));
  });
});

describe("evidenceFidelityGroundingEnabled (evidence_fidelity_canary_scope_v1)", () => {
  const WORKSPACE_A = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
  const WORKSPACE_B = "9c8b5290-65c8-5dd1-b5b4-2613ed3df93b";

  it("defaults to false, and is explicit-string-gated (not merely truthy)", () => {
    expect(evidenceFidelityGroundingEnabled({ env: {}, workspaceId: WORKSPACE_A })).toBe(false);
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "false", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: WORKSPACE_A }, workspaceId: WORKSPACE_A })).toBe(false);
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "1", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: WORKSPACE_A }, workspaceId: WORKSPACE_A })).toBe(false);
  });

  // A: enabled=false, workspace A -> legacy
  it("A: enabled=false with a matching workspace is still disabled", () => {
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "false", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: WORKSPACE_A }, workspaceId: WORKSPACE_A })).toBe(false);
  });

  // B: enabled=true, allowlist missing, workspace A -> legacy (fail closed, never global)
  it("B: enabled=true with an absent allowlist fails closed as disabled for every workspace", () => {
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true" }, workspaceId: WORKSPACE_A })).toBe(false);
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: "" }, workspaceId: WORKSPACE_A })).toBe(false);
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true" }, workspaceId: undefined })).toBe(false);
  });

  // C: enabled=true, allowlist=A, workspace A -> fidelity active
  it("C: enabled=true with workspace A allowlisted activates fidelity for workspace A", () => {
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: WORKSPACE_A }, workspaceId: WORKSPACE_A })).toBe(true);
  });

  // D: enabled=true, allowlist=A, workspace B -> legacy
  it("D: enabled=true with only workspace A allowlisted leaves workspace B on legacy behavior", () => {
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: WORKSPACE_A }, workspaceId: WORKSPACE_B })).toBe(false);
  });

  // E: enabled=true, allowlist=A,B, workspace B -> fidelity active
  it("E: enabled=true with both workspaces allowlisted activates fidelity for workspace B too", () => {
    expect(evidenceFidelityGroundingEnabled({ env: { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: `${WORKSPACE_A},${WORKSPACE_B}` }, workspaceId: WORKSPACE_B })).toBe(true);
  });

  // F: whitespace/duplicate IDs normalized safely
  it("F: whitespace and duplicate IDs in the allowlist are normalized safely", () => {
    const env = { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: `  ${WORKSPACE_A} ,, ${WORKSPACE_A},${WORKSPACE_B}  ` };
    expect(evidenceFidelityGroundingEnabled({ env, workspaceId: WORKSPACE_A })).toBe(true);
    expect(evidenceFidelityGroundingEnabled({ env, workspaceId: WORKSPACE_B })).toBe(true);
    expect(evidenceFidelityGroundingEnabled({ env, workspaceId: "unrelated-workspace" })).toBe(false);
  });

  // H: semantic shadow allowlist does NOT implicitly activate fidelity
  it("H: setting only the semantic-shadow workspace allowlist does not activate evidence fidelity", () => {
    const env = { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", SEMANTIC_REASONING_SHADOW_ENABLED: "true", SEMANTIC_REASONING_SHADOW_WORKSPACE_IDS: WORKSPACE_A };
    expect(evidenceFidelityGroundingEnabled({ env, workspaceId: WORKSPACE_A })).toBe(false);
  });
});

// I: fidelity allowlist does NOT implicitly activate semantic shadow
describe("getSemanticReasoningShadowConfig is independent of the evidence-fidelity allowlist", () => {
  it("setting only EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS does not activate or scope semantic shadow", async () => {
    const { getSemanticReasoningShadowConfig } = await import("../../src/server/modules/intelligence/semantic-reasoning-shadow.config");
    const workspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
    const env = { SEMANTIC_REASONING_SHADOW_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: workspaceId };
    expect(getSemanticReasoningShadowConfig(env, workspaceId)).toMatchObject({ enabled: false });
  });
});
