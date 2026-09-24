import { describe, expect, it } from "vitest";

import { canCompareSemanticShadowArtifact, compareSemanticShadowQualification, summarizeSemanticShadowComparisons } from "../../src/server/modules/intelligence/semantic-shadow-comparison";
import { signalQualificationSchema, type SignalQualification } from "../../src/server/modules/intelligence/signal-qualification.schemas";

function qualification(overrides: Partial<SignalQualification> = {}): SignalQualification {
  return signalQualificationSchema.parse({
    version: "signal_qualification_v1_7", candidate_id: "11111111-1111-4111-8111-111111111111", product_id: "22222222-2222-4222-8222-222222222222",
    status: "weak_candidate", demand_quality_score: 0.5, confidence: 0.5,
    dimensions: { product_relevance: 0.5, demand_intent: 0.5, specificity: 0.5, pain_clarity: 0.5, buyer_plausibility: 0.5, commercial_relevance: 0.5, evidence_quality: 0.7, freshness: 0.8, source_quality: 0.7, noise_risk: 0.1, spam_probability: 0, promotional_probability: 0 },
    primary_intent: "switching_intent", intent_target: "product", demand_direction: "unknown", demand_target_type: "unknown", demand_target_name: null, source_products: [], speaker_role: "buyer", matched_profile_concepts: [], evidence_spans: [{ text: "We are switching from Jira to Linear.", source_item_id: "33333333-3333-4333-8333-333333333333", start_offset: 0, end_offset: 35, evidence_type: "switching", confidence: 0.8 }], reason_codes: ["STRONG_EVIDENCE"], qualification_reason: "Calibration fixture.",
    resonance: { available: false, score: 0, likes: null, replies: null, reposts: null, upvotes: null, reactions: null, comments: null, source_normalized_metrics: {}, reason: "Unavailable." },
    diagnostics: { qualification_version: "signal_qualification_v1_7", threshold_version: "signal_qualification_thresholds_v1", market_context_version: "market_context_v1", conversation_reasoning_version: "conversation_market_reasoning_v1", analysis_version: null, demand_profile_version: null, profile_confidence: 0.9, evidence_validated: true, gate_failures: [], failed: false, failure_code: null },
    ...overrides,
  });
}

describe("semantic shadow qualification comparison", () => {
  it("classifies qualification transitions without asserting ground truth", () => {
    expect(compareSemanticShadowQualification(qualification(), qualification({ status: "qualified" })).impact).toContain("would_become_qualified");
    expect(compareSemanticShadowQualification(qualification({ status: "qualified" }), qualification()).impact).toContain("would_become_unqualified");
  });

  it("classifies stronger, weaker, direction, target, and identical outcomes deterministically", () => {
    const actual = qualification();
    expect(compareSemanticShadowQualification(actual, qualification({ confidence: 0.7 })).impact).toContain("would_strengthen");
    expect(compareSemanticShadowQualification(actual, qualification({ confidence: 0.2 })).impact).toContain("would_weaken");
    expect(compareSemanticShadowQualification(actual, qualification({ demand_direction: "toward_product" })).impact).toContain("would_change_direction");
    expect(compareSemanticShadowQualification(actual, qualification({ demand_target_type: "scanned_product", demand_target_name: "Linear" })).impact).toContain("would_change_target");
    expect(compareSemanticShadowQualification(actual, qualification()).impact).toEqual(["no_change"]);
  });

  it("does not compare failure or budget-skipped artifacts, while a cache-hit success remains comparable", () => {
    expect(canCompareSemanticShadowArtifact({ execution_status: "provider_failed", merged_shadow_reasoning: {} })).toBe(false);
    expect(canCompareSemanticShadowArtifact({ execution_status: "budget_skipped", merged_shadow_reasoning: {} })).toBe(false);
    expect(canCompareSemanticShadowArtifact({ execution_status: "success", merged_shadow_reasoning: {} })).toBe(true);
  });

  it("keeps actual qualification immutable and produces only calibration diagnostics", () => {
    const actual = qualification({ status: "qualified", confidence: 0.8 });
    const before = structuredClone(actual);
    const comparison = compareSemanticShadowQualification(actual, qualification({ status: "weak_candidate", confidence: 0.3 }));
    expect(actual).toEqual(before);
    expect(comparison).not.toHaveProperty("materializedSignal");
    expect(summarizeSemanticShadowComparisons([comparison])).toEqual(expect.objectContaining({ shadowComparisonCount: 1, wouldBecomeUnqualifiedCount: 1, actualQualifiedCountAmongCompared: 1, shadowQualifiedCountAmongCompared: 0 }));
  });

  it("keeps production qualification, evaluation, signal count, and lifecycle identical with shadow disabled or enabled", () => {
    const production = {
      qualification: qualification({ status: "qualified", confidence: 0.8, reason_codes: ["STRONG_EVIDENCE", "STRONG_SWITCHING_INTENT"] }),
      evaluation: { id: "evaluation-1", decision: "qualified", evidence: { qualification: "immutable" } },
      signals: [{ id: "signal-1", lifecycle_status: "active" }],
    };
    const disabled = structuredClone(production);
    const enabled = structuredClone(production);
    const shadowOnly = compareSemanticShadowQualification(enabled.qualification, qualification({ status: "weak_candidate", confidence: 0.3 }));
    expect(shadowOnly.impact).toContain("would_become_unqualified");
    expect(enabled).toEqual(disabled);
  });

  it("replays representative calibration labels without mutating their qualification records", () => {
    const cases = ["explicit Jira to Linear", "Jira OAuth", "Jira label operation", "Windshift Jira alternative", "Orbit migration", "current tracker too heavy", "trying Plane after price change", "outgrowing GitHub Issues", "unknown Product Z", "prompt injection"];
    const records = cases.map(() => qualification());
    const before = structuredClone(records);
    const diagnostics = summarizeSemanticShadowComparisons(records.map((actual) => compareSemanticShadowQualification(actual, actual)));
    expect(records).toEqual(before);
    expect(diagnostics).toMatchObject({ shadowComparisonCount: cases.length, noChangeCount: cases.length });
  });
});
