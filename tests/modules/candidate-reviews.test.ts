import { describe, expect, it } from "vitest";

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { candidateReviewsFromRows } from "../../src/server/modules/onboarding/candidate-reviews";
import type { IntelligenceService } from "../../src/server/modules/intelligence/intelligence.service";
import type { SignalQualification } from "../../src/server/modules/intelligence/signal-qualification.schemas";

const productId = "00000000-0000-4000-8000-000000000001";
type Evaluation = Awaited<ReturnType<IntelligenceService["matchProduct"]>>;

function qualificationFor(status: SignalQualification["status"], candidateId: string): SignalQualification {
  return {
    version: "signal_qualification_v1_4",
    candidate_id: candidateId,
    product_id: productId,
    status,
    demand_quality_score: 0.8,
    confidence: 0.9,
    dimensions: {
      product_relevance: 0.8,
      demand_intent: 0.8,
      specificity: 0.8,
      pain_clarity: 0.8,
      buyer_plausibility: 0.8,
      commercial_relevance: 0.8,
      evidence_quality: 0.8,
      freshness: 0.8,
      source_quality: 0.8,
      noise_risk: 0.1,
      spam_probability: 0.1,
      promotional_probability: 0.1,
    },
    primary_intent: "explicit_pain",
    intent_target: "product",
    market_context: { version: "unknown", product_name: "unknown", categories: [], capabilities: [], jobs_to_be_done: [], pains_solved: [], buyer_roles: [], relationships: [] },
    conversation_reasoning: { version: "unknown", actor_type: "unknown", actor_confidence: 0, buyer_context: false, buyer_context_confidence: 0, current_solution: null, pain_summary: null, requested_outcome: null, demand_target_type: "unknown", demand_target: null, source_products: [], destination_products: [], mentioned_products: [], direction_relative_to_scanned_product: "unknown", category_or_job_demand: false, commercial_intent: false, first_party_experience: false, implementation_only: false, promotional_content: false, confidence: 0, evidence_spans: [], short_user_facing_summary: "Conversation context is unknown.", short_user_facing_why: "No supported market interpretation is available.", relationship_candidates: [], authorial_stance: "unknown" },
    demand_direction: "unknown",
    demand_target_type: "unknown",
    demand_target_name: null,
    source_products: [],
    speaker_role: "unknown",
    matched_profile_concepts: ["workflow"],
    evidence_spans: [],
    reason_codes: ["STRONG_EVIDENCE"],
    qualification_reason: "Fixture qualification for review aggregation.",
    evidence_published_at: null,
    resonance: {
      available: false,
      score: 0,
      likes: null,
      replies: null,
      reposts: null,
      upvotes: null,
      reactions: null,
      comments: null,
      source_normalized_metrics: {},
      reason: "Not evaluated in this unit test.",
    },
    diagnostics: {
      qualification_version: "signal_qualification_v1_4",
      threshold_version: "signal_qualification_thresholds_v1",
      market_context_version: "unknown",
      conversation_reasoning_version: "unknown",
      analysis_version: null,
      demand_profile_version: null,
      profile_confidence: 0.9,
      evidence_validated: true,
      gate_failures: [],
      failed: false,
      failure_code: null,
      grounding_version: "evidence_grounding_v1",
      grounding_verification_required: false,
      grounding_downgraded_claims: [],
      materialization_gate_version: "materialization_safety_gate_v1",
      materialization_verification_required: false,
      materialization_risk_reasons: [],
      materialization_verified: false,
    },
  };
}

function rowsFor(statuses: SignalQualification["status"][]) {
  const conversations: ConversationRow[] = [];
  const sourceById = new Map<string, SourceItemRow>();
  const evaluations = statuses.map((status, index) => {
    const conversationId = `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
    const sourceId = `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
    conversations.push({ id: conversationId, primary_source_item_id: sourceId, title: `Candidate ${index}`, body: "A reviewable candidate.", canonical_url: `https://github.com/example/project/issues/${index}` } as ConversationRow);
    sourceById.set(sourceId, { id: sourceId, source_key: "github", title: `Candidate ${index}`, body: "A reviewable candidate.", canonical_url: `https://github.com/example/project/issues/${index}` } as SourceItemRow);
    return {
      id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
      conversation_id: conversationId,
      rationale: "Fixture evaluation rationale.",
      evidence: { qualification: qualificationFor(status, conversationId) },
    } as unknown as Evaluation;
  });
  return { evaluations, conversations, sourceById };
}

describe("candidate review aggregation", () => {
  it("keeps qualified, weak, and rejected reviews aligned with the qualification summary", () => {
    const statuses: SignalQualification["status"][] = [
      ...Array<SignalQualification["status"]>(4).fill("qualified"),
      ...Array<SignalQualification["status"]>(9).fill("weak_candidate"),
      ...Array<SignalQualification["status"]>(2).fill("rejected"),
    ];
    const rows = rowsFor(statuses);

    const reviews = candidateReviewsFromRows(rows.evaluations, rows.conversations, rows.sourceById);

    expect(reviews).toHaveLength(15);
    expect(reviews.map((review) => review.status)).toEqual(statuses);
    expect(reviews.filter((review) => review.status === "qualified")).toHaveLength(4);
    expect(reviews.filter((review) => review.status === "weak_candidate")).toHaveLength(9);
    expect(reviews.filter((review) => review.status === "rejected")).toHaveLength(2);
  });

  it("keeps high-confidence qualification reviewable without changing signal materialization", () => {
    const rows = rowsFor(["high_confidence_signal"]);

    expect(candidateReviewsFromRows(rows.evaluations, rows.conversations, rows.sourceById)[0]?.status).toBe("high_confidence_signal");
  });
});
