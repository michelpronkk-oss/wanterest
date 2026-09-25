import { describe, expect, it } from "vitest";

import { sha256Json, sha256Text } from "../../src/server/modules/ingestion/hash";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine, InMemoryIntelligenceRepository, IntelligenceService, SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION, calculateOpportunityScore, freshnessScore, RANKING_WEIGHTS, transitionSignalLifecycle } from "../../src/server/modules/intelligence";
import type { ConversationRow, ProductRow, SourceItemRow } from "../../src/server/db/database.helpers";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const sourceItemId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

function fixtures() {
  const repository = new InMemoryIntelligenceRepository();
  const product: ProductRow = { id: productId, workspace_id: workspaceId, name: "Workflow Helper", slug: "workflow-helper", website_url: null, status: "active", current_snapshot_id: null, current_demand_profile_id: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" };
  const source: SourceItemRow = { id: sourceItemId, evidence_node_id: "55555555-5555-4555-8555-555555555555", source_key: "fixture", external_id: "fixture-1", external_conversation_id: null, canonical_url: "https://example.com/thread", author_external_id: null, author_display_name: "Public author", author_profile_url: null, title: "Workflow reporting pain", body: "I need a workflow tool because manual reporting is slow and frustrating.", published_at: "2026-09-19T00:00:00.000Z", captured_at: "2026-09-19T00:00:00.000Z", language: "en", metadata: {}, content_hash: sha256Text("conversation"), latest_raw_source_item_id: "66666666-6666-4666-8666-666666666666", normalization_version: "fixture-v1", status: "active", created_at: "2026-09-19T00:00:00.000Z", updated_at: "2026-09-19T00:00:00.000Z" };
  const conversation: ConversationRow = { id: conversationId, evidence_node_id: "77777777-7777-4777-8777-777777777777", conversation_key: "fixture:thread:1", primary_source_item_id: sourceItemId, canonical_url: source.canonical_url, author_external_id: null, author_display_name: source.author_display_name, author_profile_url: null, title: source.title, body: source.body, published_at: source.published_at, last_activity_at: source.published_at, captured_at: source.captured_at, language: "en", metadata: {}, content_hash: source.content_hash, canonicalization_version: "canonical-v1", created_at: source.created_at, updated_at: source.updated_at };
  repository.products.set(product.id, product); repository.sourceItems.set(source.id, source); repository.conversations.set(conversation.id, conversation);
  return { repository, product, source, conversation, service: new IntelligenceService(repository) };
}

describe("Phase 3 intelligence pipeline", () => {
  it("creates immutable snapshot/profile, analysis, match, ranking, and one signal", async () => {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());
    const evaluation = await service.matchProduct(product, profile.id, analysis.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    expect(evaluation.decision).toBe("qualified");
    const ranking = await service.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(ranking).not.toBeNull();
    if (!ranking) throw new Error("Expected qualified evaluation to rank.");
    const signal = await service.materializeSignal(product, evaluation.id, ranking.id);
    expect(signal?.intent_type).toBe("high_intent");
    expect(signal?.evidence_node_id).toBeTruthy();
    expect(repository.provenance.some((edge) => edge.relationType === "ranks_match_evaluation")).toBe(true);
    expect(repository.provenance.some((edge) => edge.relationType === "uses_demand_profile")).toBe(true);
    expect((await service.materializeSignal(product, evaluation.id, ranking.id))?.id).toBe(signal?.id);
    expect(repository.consumedUsage.size).toBe(1);
  });

  it("is replay-safe and preserves new engine versions", async () => {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "A tool for workflow reporting and automation." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const engine = new FixtureConversationAnalysisEngine();
    const first = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", engine);
    const retry = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", engine);
    const replay = await service.analyzeConversation(conversation, source, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", engine);
    expect(retry.id).toBe(first.id);
    expect(replay.id).not.toBe(first.id);
    const match = await service.matchProduct(product, profile.id, first.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    const rank = await service.rankEvaluation(product, match.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(rank).not.toBeNull();
    if (!rank) throw new Error("Expected qualified evaluation to rank.");
    expect(repository.analyses.size).toBe(2);
    expect(rank.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(rank.opportunity_score).toBeLessThanOrEqual(1);
  });

  it("keeps the ranking formula normalized and freshness bounded", () => {
    expect(Object.values(RANKING_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(freshnessScore(null)).toBe(0.5);
    expect(freshnessScore("2026-09-20T00:00:00.000Z", new Date("2026-09-20T00:00:00.000Z"))).toBe(1);
    expect(calculateOpportunityScore({ semanticRelevance: 1, painAlignment: 1, buyerAlignment: 1, intentStrength: 1, specificity: 1, freshness: 1, sourceQuality: 1 })).toBe(1);
  });
});

describe("Signal lifecycle (dismiss/save)", () => {
  async function qualifiedSignal() {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());
    const evaluation = await service.matchProduct(product, profile.id, analysis.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    const ranking = await service.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    if (!ranking) throw new Error("Expected qualified evaluation to rank.");
    const signal = await service.materializeSignal(product, evaluation.id, ranking.id);
    if (!signal) throw new Error("Expected a materialized signal.");
    return { service, product, repository, evaluation, ranking, signal, profile };
  }

  it("excludes dismissed (and archived) signals from the default active view, but includes active and saved", async () => {
    const { service, product, repository, signal } = await qualifiedSignal();
    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });

    const defaultView = await service.listSignals(product.workspace_id, product.id);
    expect(defaultView.find((row) => row.signalId === signal.id)).toBeUndefined();

    await repository.updateSignal(signal.id, { lifecycle_status: "saved" });
    const afterSaved = await service.listSignals(product.workspace_id, product.id);
    expect(afterSaved.find((row) => row.signalId === signal.id)).toBeDefined();
  });

  it("filters explicitly by lifecycleStatus (the Saved page / dismissed filter contract)", async () => {
    const { service, product, repository, signal } = await qualifiedSignal();
    await repository.updateSignal(signal.id, { lifecycle_status: "saved" });

    const saved = await service.listSignals(product.workspace_id, product.id, { lifecycleStatus: "saved" });
    expect(saved.map((row) => row.signalId)).toEqual([signal.id]);

    const dismissed = await service.listSignals(product.workspace_id, product.id, { lifecycleStatus: "dismissed" });
    expect(dismissed).toHaveLength(0);

    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });
    const dismissedAfter = await service.listSignals(product.workspace_id, product.id, { lifecycleStatus: "dismissed" });
    expect(dismissedAfter.map((row) => row.signalId)).toEqual([signal.id]);
    // Saved+dismissed is not an ambiguous combined state: setting dismissed clears "saved".
    const savedAfter = await service.listSignals(product.workspace_id, product.id, { lifecycleStatus: "saved" });
    expect(savedAfter).toHaveLength(0);
  });

  it("does not resurrect a dismissed signal when the same evidence is re-materialized (rescan/monitoring)", async () => {
    const { service, product, repository, evaluation, ranking, signal } = await qualifiedSignal();
    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });

    // materializeSignal is the single shared re-discovery path used by manual
    // rescans, monitoring cycles, and onboarding alike; it is scanMode-agnostic.
    const rematerialized = await service.materializeSignal(product, evaluation.id, ranking.id);
    expect(rematerialized?.id).toBe(signal.id);
    expect(rematerialized?.lifecycle_status).toBe("dismissed");

    const activeView = await service.listSignals(product.workspace_id, product.id);
    expect(activeView).toHaveLength(0);
  });

  it("excludes invalidated and retracted signals from current reads while preserving audit reads and evidence", async () => {
    const { service, product, repository, evaluation, signal } = await qualifiedSignal();
    const unrelatedSignal = { ...signal, id: "99999999-9999-4999-8999-999999999999", conversation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    repository.signals.set(unrelatedSignal.id, unrelatedSignal);
    const originalEvaluation = await repository.getEvaluationById(evaluation.id);
    const originalEvidence = originalEvaluation?.evidence;
    const invalidated = await transitionSignalLifecycle(repository, {
      workspaceId: product.workspace_id,
      signalId: signal.id,
      to: "invalidated",
      reason: "historical_clause_binding_false_positive",
      actor: "signal-lifecycle-test",
    }, new Date("2026-09-25T12:00:00.000Z"));

    expect(invalidated.lifecycle_status).toBe("invalidated");
    expect((invalidated as unknown as { invalidated_reason: string }).invalidated_reason).toBe("historical_clause_binding_false_positive");
    expect((invalidated as unknown as { invalidated_at: string }).invalidated_at).toBe("2026-09-25T12:00:00.000Z");
    expect((await service.listSignals(product.workspace_id, product.id)).find((row) => row.signalId === signal.id)).toBeUndefined();
    expect((await service.listSignals(product.workspace_id, product.id, { lifecycleStatus: "invalidated" })).map((row) => row.signalId)).toEqual([signal.id]);
    expect((await repository.getEvaluationById(evaluation.id))?.evidence).toEqual(originalEvidence);
    expect((await repository.getSignal(unrelatedSignal.id))?.lifecycle_status).toBe("active");

    const repeated = await transitionSignalLifecycle(repository, {
      workspaceId: product.workspace_id,
      signalId: signal.id,
      to: "invalidated",
      reason: "historical_clause_binding_false_positive",
      actor: "signal-lifecycle-test",
    }, new Date("2026-09-26T12:00:00.000Z"));
    expect(repeated).toBe(invalidated);

    const retracted = await transitionSignalLifecycle(repository, {
      workspaceId: product.workspace_id,
      signalId: signal.id,
      to: "retracted",
      reason: "source_withdrawn",
      actor: "signal-lifecycle-test",
    }, new Date("2026-09-25T13:00:00.000Z"));
    expect(retracted.lifecycle_status).toBe("retracted");
    expect((await service.listSignals(product.workspace_id, product.id)).find((row) => row.signalId === signal.id)).toBeUndefined();
    await expect(transitionSignalLifecycle(repository, { workspaceId: product.workspace_id, signalId: signal.id, to: "active" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never auto-archives a user-dismissed (or saved) signal when re-qualification later fails", async () => {
    const { service, product, repository, evaluation, signal } = await qualifiedSignal();
    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });

    // Force the stored evaluation's qualification to look like it no longer
    // qualifies (re-evaluation regressed it), then rank again.
    const stored = await repository.getEvaluationById(evaluation.id);
    if (!stored) throw new Error("Expected evaluation to exist.");
    const evidence = stored.evidence as Record<string, unknown>;
    const qualification = evidence.qualification as Record<string, unknown>;
    repository.evaluations.set(evaluation.id, { ...stored, evidence: { ...evidence, qualification: { ...qualification, status: "weak_candidate" } } });

    const result = await service.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result).toBeNull();

    const untouched = await repository.getSignal(signal.id);
    expect(untouched?.lifecycle_status).toBe("dismissed");
  });

  it("still creates a new signal from genuinely different evidence even when a related signal was dismissed", async () => {
    const { service, product, repository, signal } = await qualifiedSignal();
    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });

    const otherSourceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const otherConversationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const otherSource = { ...repository.sourceItems.get(sourceItemId)!, id: otherSourceId, external_id: "fixture-2", canonical_url: "https://example.com/other-thread", body: "Completely different topic: pricing page localization for EU buyers.", content_hash: sha256Text("a genuinely different conversation") };
    const otherConversation = { ...repository.conversations.get(conversationId)!, id: otherConversationId, primary_source_item_id: otherSourceId, canonical_url: otherSource.canonical_url, body: otherSource.body, content_hash: otherSource.content_hash };
    repository.sourceItems.set(otherSource.id, otherSource);
    repository.conversations.set(otherConversation.id, otherConversation);

    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting.", forceNewSnapshot: true });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(otherConversation, otherSource, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());
    const evaluation = await service.matchProduct(product, profile.id, analysis.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    const ranking = await service.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    if (!ranking) throw new Error("Expected the new conversation to qualify and rank.");
    const newSignal = await service.materializeSignal(product, evaluation.id, ranking.id);

    expect(newSignal).not.toBeNull();
    expect(newSignal?.id).not.toBe(signal.id);
    expect(newSignal?.lifecycle_status).toBe("active");
  });
});

describe("Qualification version-aware evaluation cache (signal_qualification version bump)", () => {
  const matcherEngineVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OLD_QUALIFICATION_VERSION = "signal_qualification_v1_1";

  // Regression coverage for the exact production bug: matchProduct's evaluation cache key
  // (input_fingerprint, in intelligence.service.ts) hashes qualification.version alongside
  // matchId/profileId/analysisId/engineVersionId. As long as SIGNAL_QUALIFICATION_VERSION
  // never actually changes when the underlying scoring formula does, that hash stays
  // identical across a scoring-logic change, getEvaluation() keeps matching the pre-existing
  // row, and matchProduct returns it unchanged — the new formula is computed and then
  // silently discarded every time. Bumping the version is what makes the fingerprint (and
  // therefore the cache) miss and forces a real recompute, without re-fetching the source,
  // re-analyzing the conversation, or duplicating the match.

  async function seedOldVersionedEvaluation(repository: InMemoryIntelligenceRepository, product: ProductRow, conversation: ConversationRow, profile: { id: string }, analysis: { id: string }) {
    const match = await repository.createMatch({ workspace_id: product.workspace_id, product_id: product.id, conversation_id: conversation.id, evidence_node_id: `evidence:match:${product.id}:${conversation.id}` });
    const oldFingerprint = sha256Json({
      matchId: match.id,
      profileId: profile.id,
      analysisId: analysis.id,
      engineVersionId: matcherEngineVersionId,
      qualificationVersion: OLD_QUALIFICATION_VERSION,
      thresholdVersion: SIGNAL_QUALIFICATION_THRESHOLD_VERSION,
      demandProfileVersion: null,
    });
    // Mirrors the exact real-world shape and value (relevance 0.57655) confirmed stuck in
    // production before this fix, under the qualification version that never bumped.
    const oldDimensions = { product_relevance: 0.57655, demand_intent: 0.9, specificity: 0.65, pain_clarity: 0.15, buyer_plausibility: 0.25, commercial_relevance: 0.3, evidence_quality: 0.8184, freshness: 0.9, source_quality: 0.65, noise_risk: 0.1, spam_probability: 0, promotional_probability: 0 };
    const oldQualification = {
      version: OLD_QUALIFICATION_VERSION,
      candidate_id: conversation.id,
      product_id: product.id,
      status: "weak_candidate",
      demand_quality_score: 0.4,
      confidence: 0.6,
      dimensions: oldDimensions,
      primary_intent: "alternative_search",
      matched_profile_concepts: ["jira"],
      evidence_spans: [],
      reason_codes: ["LOW_RELEVANCE"],
      qualification_reason: "Retained as a weak candidate.",
      resonance: { available: false, score: 0, likes: null, replies: null, reposts: null, upvotes: null, reactions: null, comments: null, source_normalized_metrics: {}, reason: "Not evaluated." },
      diagnostics: { qualification_version: OLD_QUALIFICATION_VERSION, threshold_version: SIGNAL_QUALIFICATION_THRESHOLD_VERSION, analysis_version: null, demand_profile_version: null, profile_confidence: 0.9, evidence_validated: false, gate_failures: ["product_relevance"], failed: false, failure_code: null },
    };
    const evaluation = await repository.createEvaluation({
      workspace_id: product.workspace_id,
      product_match_id: match.id,
      product_id: product.id,
      conversation_id: conversation.id,
      demand_profile_id: profile.id,
      conversation_analysis_id: analysis.id,
      match_engine_version_id: matcherEngineVersionId,
      evidence_node_id: `evidence:evaluation:${match.id}:old`,
      input_fingerprint: oldFingerprint,
      match_confidence: 0.537,
      rationale: "Old evaluation computed under signal_qualification_v1_1.",
      evidence: { painAlignment: ["jira"], buyerAlignment: [], capabilityAlignment: [], intentRelevance: ["alternative_search"], qualification: oldQualification },
      decision: "weak",
    });
    await repository.setCurrentEvaluation(match.id, evaluation.id);
    return { match, evaluation };
  }

  it("recomputes qualification (does not blindly reuse the old version's cached output) when the qualification version has changed, without duplicating the conversation or match", async () => {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());

    const { match: oldMatch, evaluation: oldEvaluation } = await seedOldVersionedEvaluation(repository, product, conversation, profile, analysis);
    expect(oldEvaluation.input_fingerprint).not.toBe(""); // sanity: a fingerprint was actually computed

    // The current code path — same conversation, same analysis, same demand profile, same
    // matcher engine version — run exactly as a fresh scan would run it today.
    const recomputed = await service.matchProduct(product, profile.id, analysis.id, matcherEngineVersionId, new FixtureProductMatchingEngine());

    expect(recomputed.id).not.toBe(oldEvaluation.id);
    expect(recomputed.product_match_id).toBe(oldMatch.id); // the existing match is reused, not duplicated
    const recomputedQualification = (recomputed.evidence as Record<string, unknown>).qualification as { version: string; dimensions: { product_relevance: number } };
    expect(recomputedQualification.version).toBe(SIGNAL_QUALIFICATION_VERSION);
    expect(recomputedQualification.version).not.toBe(OLD_QUALIFICATION_VERSION);

    // No re-fetching, no duplicate conversation/source/match — only a new evaluation row.
    expect(repository.conversations.size).toBe(1);
    expect(repository.sourceItems.size).toBe(1);
    expect(repository.matches.size).toBe(1);
    expect(repository.evaluations.size).toBe(2); // old row preserved for history + the new one
  });

  it("still reuses the cached evaluation when the qualification version has NOT changed", async () => {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());

    const first = await service.matchProduct(product, profile.id, analysis.id, matcherEngineVersionId, new FixtureProductMatchingEngine());
    const second = await service.matchProduct(product, profile.id, analysis.id, matcherEngineVersionId, new FixtureProductMatchingEngine());

    expect(second.id).toBe(first.id);
    expect(repository.evaluations.size).toBe(1);
  });

  it("preserves a dismissed signal's lifecycle when its evaluation is recomputed under a new qualification version", async () => {
    const { service, product, source, conversation, repository } = fixtures();
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());

    // Establish the pre-existing, currently-active signal exactly as production has it today.
    const firstEvaluation = await service.matchProduct(product, profile.id, analysis.id, matcherEngineVersionId, new FixtureProductMatchingEngine());
    const firstRanking = await service.rankEvaluation(product, firstEvaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    if (!firstRanking) throw new Error("Expected the fixture conversation to qualify and rank.");
    const signal = await service.materializeSignal(product, firstEvaluation.id, firstRanking.id);
    if (!signal) throw new Error("Expected a materialized signal.");
    await repository.updateSignal(signal.id, { lifecycle_status: "dismissed" });

    // Force a cache miss the same way a real version bump does: the stored evaluation no
    // longer matches the fingerprint the current code computes, so matchProduct recomputes.
    repository.evaluations.delete(firstEvaluation.id);
    const match = await repository.getMatchById(firstEvaluation.product_match_id);
    if (!match) throw new Error("Expected the match to still exist.");
    await repository.setCurrentEvaluation(match.id, "");

    const recomputedEvaluation = await service.matchProduct(product, profile.id, analysis.id, matcherEngineVersionId, new FixtureProductMatchingEngine());
    expect(recomputedEvaluation.id).not.toBe(firstEvaluation.id);
    expect(recomputedEvaluation.product_match_id).toBe(match.id);

    const recomputedRanking = await service.rankEvaluation(product, recomputedEvaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    if (!recomputedRanking) throw new Error("Expected the recomputed evaluation to still qualify and rank.");
    const rematerialized = await service.materializeSignal(product, recomputedEvaluation.id, recomputedRanking.id);

    // Same underlying match -> same signal row, found and updated, not recreated -> dismissal survives.
    expect(rematerialized?.id).toBe(signal.id);
    expect(rematerialized?.lifecycle_status).toBe("dismissed");
    expect(repository.signals.size).toBe(1);

    const activeView = await service.listSignals(product.workspace_id, product.id);
    expect(activeView).toHaveLength(0);
  });
});
