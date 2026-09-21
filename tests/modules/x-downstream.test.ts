import { describe, expect, it } from "vitest";

import { sha256Text } from "../../src/server/modules/ingestion/hash";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine, InMemoryIntelligenceRepository, IntelligenceService } from "../../src/server/modules/intelligence";
import type { ConversationRow, ProductRow, SourceItemRow } from "../../src/server/db/database.helpers";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const sourceItemId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

describe("X downstream compatibility", () => {
  it("passes normalized X evidence through analysis, matching, ranking, and signal materialization", async () => {
    const repository = new InMemoryIntelligenceRepository();
    const product: ProductRow = { id: productId, workspace_id: workspaceId, name: "Workflow Helper", slug: "workflow-helper", website_url: null, status: "active", current_snapshot_id: null, current_demand_profile_id: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" };
    const source: SourceItemRow = { id: sourceItemId, evidence_node_id: "55555555-5555-4555-8555-555555555555", source_key: "x", external_id: "1900000000000000001", external_conversation_id: "1900000000000000001", canonical_url: "https://x.com/alice_example/status/1900000000000000001", author_external_id: "x:user:900000000000000001", author_display_name: "Alice Example", author_profile_url: "https://x.com/alice_example", title: null, body: "Looking for a calmer CRM workflow with better follow-up visibility.", published_at: "2026-09-20T08:00:00.000Z", captured_at: "2026-09-20T10:00:00.000Z", language: "en", metadata: { postId: "1900000000000000001", publicMetrics: { like_count: 4 } }, content_hash: sha256Text("x-post"), latest_raw_source_item_id: "66666666-6666-4666-8666-666666666666", normalization_version: "x-v1", status: "active", created_at: "2026-09-20T10:00:00.000Z", updated_at: "2026-09-20T10:00:00.000Z" };
    const conversation: ConversationRow = { id: conversationId, evidence_node_id: "77777777-7777-4777-8777-777777777777", conversation_key: "x:1900000000000000001", primary_source_item_id: sourceItemId, canonical_url: source.canonical_url, author_external_id: source.author_external_id, author_display_name: source.author_display_name, author_profile_url: source.author_profile_url, title: null, body: source.body, published_at: source.published_at, last_activity_at: source.published_at, captured_at: source.captured_at, language: "en", metadata: source.metadata, content_hash: source.content_hash, canonicalization_version: "canonical-v1", created_at: source.created_at, updated_at: source.updated_at };
    repository.products.set(product.id, product);
    repository.sourceItems.set(source.id, source);
    repository.conversations.set(conversation.id, conversation);
    const service = new IntelligenceService(repository);

    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Workflow automation for teams that need faster reporting." });
    const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await service.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());
    const evaluation = await service.matchProduct(product, profile.id, analysis.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    const ranking = await service.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(ranking).not.toBeNull();
    if (!ranking) throw new Error("Expected qualified evaluation to rank.");
    const signal = await service.materializeSignal(product, evaluation.id, ranking.id);

    expect(ranking.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(ranking.source_quality).toBe(0.55);
    expect(signal?.evidence_node_id).toBeTruthy();
  });
});
