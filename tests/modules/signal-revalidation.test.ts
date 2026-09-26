import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decideRevalidationAction, revalidateSignal, revalidateSignalBatch, SIGNAL_REVALIDATION_MAX_PER_TICK, SIGNAL_REVALIDATION_VERSION, type SignalRevalidationCandidate, type SignalRevalidationRepository } from "../../src/server/modules/intelligence/signal-revalidation.service";
import type { SignalQualification } from "../../src/server/modules/intelligence/signal-qualification.schemas";
import type { ConversationAnalysisRow, ConversationRow, SourceItemRow, SignalRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import type { SignalQualificationInput } from "../../src/server/modules/intelligence/signal-qualification.service";

const workspaceId = deterministicUuid("revalidation-workspace");
const productId = deterministicUuid("revalidation-product");
const otherWorkspaceId = deterministicUuid("revalidation-other-workspace");
/** Evidence fidelity enabled and scoped to exactly `workspaceId` - mirrors the production canary shape. */
const SCOPED_ENV = { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: workspaceId };

function qualification(overrides: Partial<SignalQualification> = {}): SignalQualification {
  return {
    version: "signal_qualification_v1_7",
    candidate_id: deterministicUuid("revalidation-candidate"),
    product_id: productId,
    status: "qualified",
    demand_quality_score: 0.8,
    confidence: 0.8,
    dimensions: { product_relevance: 0.8, demand_intent: 0.8, specificity: 0.8, pain_clarity: 0.8, buyer_plausibility: 0.8, commercial_relevance: 0.8, evidence_quality: 0.8, freshness: 0.8, source_quality: 0.8, noise_risk: 0.1, spam_probability: 0.1, promotional_probability: 0.1 },
    primary_intent: "explicit_pain",
    intent_target: "product",
    market_context: { version: "market_context_v1", product_name: "Calmer CRM", categories: [], capabilities: [], jobs_to_be_done: [], pains_solved: [], buyer_roles: [], relationships: [] },
    conversation_reasoning: { version: "conversation_market_reasoning_v1", actor_type: "buyer", actor_confidence: 0.7, buyer_context: true, buyer_context_confidence: 0.7, current_solution: null, pain_summary: null, requested_outcome: null, demand_target_type: "unknown", demand_target: null, source_products: [], destination_products: [], mentioned_products: [], direction_relative_to_scanned_product: "unknown", category_or_job_demand: false, commercial_intent: true, first_party_experience: true, implementation_only: false, promotional_content: false, confidence: 0.7, evidence_spans: [], short_user_facing_summary: "s", short_user_facing_why: "w", relationship_candidates: [], authorial_stance: "buyer" },
    demand_direction: "unknown",
    demand_target_type: "unknown",
    demand_target_name: null,
    source_products: [],
    speaker_role: "buyer",
    matched_profile_concepts: ["workflow"],
    evidence_spans: [{ text: "we need this", source_item_id: deterministicUuid("revalidation-source"), start_offset: 0, end_offset: 12, evidence_type: "intent", confidence: 0.8 }],
    reason_codes: ["STRONG_EVIDENCE"],
    qualification_reason: "Fixture qualification.",
    evidence_published_at: null,
    resonance: { available: false, score: 0, likes: null, replies: null, reposts: null, upvotes: null, reactions: null, comments: null, source_normalized_metrics: {}, reason: "not evaluated" },
    diagnostics: { qualification_version: "signal_qualification_v1_7", threshold_version: "signal_qualification_thresholds_v1", market_context_version: "market_context_v1", conversation_reasoning_version: "conversation_market_reasoning_v1", analysis_version: null, demand_profile_version: null, profile_confidence: 0.9, evidence_validated: true, gate_failures: [], failed: false, failure_code: null, grounding_version: "evidence_grounding_v1", grounding_verification_required: false, grounding_downgraded_claims: [], materialization_gate_version: "materialization_safety_gate_v1", materialization_verification_required: false, materialization_risk_reasons: [], materialization_verified: false },
    ...overrides,
  };
}

describe("signal revalidation decision (signal_revalidation_v1)", () => {
  it("is versioned and bounded", () => {
    expect(SIGNAL_REVALIDATION_VERSION).toBe("signal_revalidation_v1");
    expect(SIGNAL_REVALIDATION_MAX_PER_TICK).toBeGreaterThan(0);
  });

  it("invalidates when a previously materialized signal no longer qualifies", () => {
    const previous = qualification({ status: "qualified" });
    const fresh = qualification({ status: "rejected", diagnostics: { ...previous.diagnostics, gate_failures: ["product_relevance"] } });
    const decision = decideRevalidationAction({ previous, fresh });
    expect(decision.action).toBe("invalidated");
  });

  it("skips a signal that never materialized in the first place (never destructively acts on it)", () => {
    const previous = qualification({ status: "rejected" });
    const fresh = qualification({ status: "rejected" });
    const decision = decideRevalidationAction({ previous, fresh });
    expect(decision.action).toBe("skipped");
  });

  it("reports unchanged when the recomputed qualification matches exactly", () => {
    const previous = qualification();
    const fresh = qualification();
    const decision = decideRevalidationAction({ previous, fresh });
    expect(decision.action).toBe("unchanged");
  });

  it("reports reconfirmed when the signal still materializes but the qualification content changed", () => {
    const previous = qualification({ qualification_reason: "Old wording." });
    const fresh = qualification({ qualification_reason: "New, corrected wording." });
    const decision = decideRevalidationAction({ previous, fresh });
    expect(decision.action).toBe("reconfirmed");
  });
});

function repositoryFixture(signal: SignalRow): SignalRevalidationRepository {
  const state = { signal };
  return {
    getSignal: vi.fn(async (signalId: string) => (state.signal.id === signalId ? state.signal : null)),
    updateSignal: vi.fn(async (signalId: string, input) => {
      state.signal = { ...state.signal, ...input } as SignalRow;
      return state.signal;
    }),
  };
}

function signalRow(overrides: Partial<SignalRow> & Record<string, unknown> = {}): SignalRow {
  return {
    id: deterministicUuid("revalidation-signal"),
    workspace_id: workspaceId,
    product_id: productId,
    product_match_id: deterministicUuid("revalidation-match"),
    product_match_evaluation_id: deterministicUuid("revalidation-evaluation"),
    match_ranking_id: deterministicUuid("revalidation-ranking"),
    conversation_id: deterministicUuid("revalidation-conversation"),
    evidence_node_id: deterministicUuid("revalidation-evidence"),
    lifecycle_status: "active",
    lifecycle_version: null,
    invalidated_at: null,
    invalidated_reason: null,
    invalidated_by: null,
    retracted_at: null,
    retracted_reason: null,
    retracted_by: null,
    intent_type: "explicit_pain",
    excerpt: "excerpt",
    why_it_matters: "why",
    tags: [],
    buyer_language: [],
    pain_themes: [],
    source_key: "fixture",
    canonical_url: null,
    published_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as unknown as SignalRow;
}

function freshInputFixture(): SignalQualificationInput {
  const conversationId = deterministicUuid("revalidation-fresh-conversation");
  const sourceId = deterministicUuid("revalidation-fresh-source");
  const body = "HubSpot sucks.";
  const source = {
    id: sourceId, evidence_node_id: deterministicUuid("revalidation-fresh-source-evidence"), source_key: "fixture", external_id: "fixture", external_conversation_id: conversationId,
    canonical_url: null, author_external_id: "fixture:user", author_display_name: "Author", author_profile_url: null, title: null, body,
    published_at: "2026-01-01T00:00:00.000Z", captured_at: "2026-01-01T00:00:00.000Z", language: "en", metadata: {}, content_hash: sha256Text(body),
    latest_raw_source_item_id: deterministicUuid("revalidation-fresh-raw"), normalization_version: "fixture-v1", status: "active",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as SourceItemRow;
  const conversation = {
    id: conversationId, evidence_node_id: deterministicUuid("revalidation-fresh-conversation-evidence"), conversation_key: "fixture:revalidation",
    primary_source_item_id: sourceId, canonical_url: null, author_external_id: source.author_external_id, author_display_name: source.author_display_name,
    author_profile_url: null, title: null, body, published_at: source.published_at, last_activity_at: source.published_at, captured_at: source.captured_at,
    language: "en", metadata: {}, content_hash: source.content_hash, canonicalization_version: "fixture-v1", created_at: source.created_at, updated_at: source.updated_at,
  } as unknown as ConversationRow;
  const analysis = {
    id: deterministicUuid("revalidation-fresh-analysis"), conversation_id: conversationId, evidence_node_id: deterministicUuid("revalidation-fresh-analysis-evidence"),
    engine_version_id: deterministicUuid("revalidation-fresh-engine"), input_fingerprint: sha256Text("revalidation-fresh"), intent_type: "problem_signal",
    pain_themes: [], desired_outcomes: [], alternatives: [], buyer_language: [], audience_signals: [], specificity: 0.05, urgency: null, confidence: 0.4,
    status: "completed", skip_reason: null, evidence_spans: [], provider: "fixture", model: "deterministic", prompt_version: "fixture-v1", usage_metadata: {}, created_at: source.created_at,
  } as unknown as ConversationAnalysisRow;
  return {
    candidateId: conversationId, productId, productName: "Calmer CRM", conversation, sourceItem: source, analysis,
    match: { decision: "rejected", matchConfidence: 0.1, rationale: "no longer relevant", evidence: { painAlignment: [], buyerAlignment: [], capabilityAlignment: [], intentRelevance: [] } },
    profile: { relevant_pains: [], relevant_outcomes: [], relevant_intents: [], relevant_jtbd: [], relevant_features: [], buyer_roles: [], competitors: [], alternatives: [], geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] }, profile_confidence: 0.9, primary_category: "CRM", profile_version: null },
    now: new Date("2026-09-26T00:00:00.000Z"),
    groundingEnabled: true,
  };
}

describe("signal revalidation orchestration", () => {
  it("transitions a signal to invalidated via the existing lifecycle primitive when recomputation no longer materializes", async () => {
    const signal = signalRow();
    const repository = repositoryFixture(signal);
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    const outcome = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(outcome.action).toBe("invalidated");
    expect(repository.updateSignal).toHaveBeenCalledWith(signal.id, expect.objectContaining({ lifecycle_status: "invalidated", invalidated_reason: "evidence_fidelity_revalidation" }));
  });

  it("never deletes the signal row - it only ever updates lifecycle fields", async () => {
    const signal = signalRow();
    const repository = repositoryFixture(signal);
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(repository.getSignal).toHaveBeenCalled();
    const stored = await repository.getSignal(signal.id);
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(signal.id);
  });

  it("is idempotent: revalidating an already-invalidated signal twice does not throw and does not double-transition", async () => {
    const signal = signalRow({ lifecycle_status: "invalidated", invalidated_at: "2026-09-01T00:00:00.000Z", invalidated_reason: "evidence_fidelity_revalidation", invalidated_by: "system:signal_revalidation_v1" });
    const repository = repositoryFixture(signal);
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    const first = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    const second = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(first.action).toBe("invalidated");
    expect(second.action).toBe("invalidated");
    expect(repository.updateSignal).not.toHaveBeenCalled();
  });

  it("bounds a batch to SIGNAL_REVALIDATION_MAX_PER_TICK candidates", async () => {
    const signals = Array.from({ length: SIGNAL_REVALIDATION_MAX_PER_TICK + 10 }, (_, index) => signalRow({ id: deterministicUuid(`revalidation-batch-${index}`) }));
    const repository: SignalRevalidationRepository = {
      getSignal: vi.fn(async (signalId: string) => signals.find((row) => row.id === signalId) ?? null),
      updateSignal: vi.fn(async (signalId: string, input) => {
        const index = signals.findIndex((row) => row.id === signalId);
        signals[index] = { ...signals[index], ...input } as SignalRow;
        return signals[index]!;
      }),
    };
    const candidates: SignalRevalidationCandidate[] = signals.map((row) => ({ signalId: row.id, workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() }));
    const outcomes = await revalidateSignalBatch(repository, candidates, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(outcomes).toHaveLength(SIGNAL_REVALIDATION_MAX_PER_TICK);
  });

  it("fails closed (skips, never invalidates) when the signal cannot be found rather than throwing the whole batch", async () => {
    const repository: SignalRevalidationRepository = { getSignal: vi.fn(async () => null), updateSignal: vi.fn() };
    const candidate: SignalRevalidationCandidate = { signalId: deterministicUuid("missing-signal"), workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    const outcomes = await revalidateSignalBatch(repository, [candidate], new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(outcomes[0]?.action).toBe("skipped");
  });

  it("a flag-off revalidation pass is a deliberate no-op - it never invalidates, even a signal that would fail closed under the new gate", async () => {
    const signal = signalRow();
    const repository = repositoryFixture(signal);
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    const outcome = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), {});
    expect(outcome.action).toBe("skipped");
    expect(outcome.reason).toBe("evidence_fidelity_grounding_disabled");
    expect(repository.updateSignal).not.toHaveBeenCalled();
  });

  // G: revalidation for a workspace outside the fidelity allowlist -> skipped,
  // even though the flag is globally on and this exact signal would otherwise
  // invalidate - the workspace scope is authoritative, not merely advisory.
  it("G: a signal belonging to a workspace outside the fidelity allowlist is skipped, not invalidated, even though the flag is globally enabled", async () => {
    const signal = signalRow({ workspace_id: otherWorkspaceId });
    const repository = repositoryFixture(signal);
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId: otherWorkspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: freshInputFixture() };
    const outcome = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(outcome.action).toBe("skipped");
    expect(outcome.reason).toBe("evidence_fidelity_grounding_disabled");
    expect(repository.updateSignal).not.toHaveBeenCalled();
  });

  it("ignores any groundingEnabled value the caller pre-set on freshInput - the workspace scope check is authoritative", async () => {
    const signal = signalRow();
    const repository = repositoryFixture(signal);
    // Caller mistakenly sets groundingEnabled: true directly, but the workspace
    // is not allowlisted in env - the service must still skip.
    const candidate: SignalRevalidationCandidate = { signalId: signal.id, workspaceId: otherWorkspaceId, previousQualification: qualification({ status: "qualified" }), freshInput: { ...freshInputFixture(), groundingEnabled: true } };
    const outcome = await revalidateSignal(repository, candidate, new Date("2026-09-26T00:00:00.000Z"), SCOPED_ENV);
    expect(outcome.action).toBe("skipped");
    expect(repository.updateSignal).not.toHaveBeenCalled();
  });
});
