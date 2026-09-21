import { describe, expect, it } from "vitest";

import { sha256Text } from "../../src/server/modules/ingestion/hash";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine, InMemoryIntelligenceRepository, IntelligenceService, calculateOpportunityScore, freshnessScore, RANKING_WEIGHTS } from "../../src/server/modules/intelligence";
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
