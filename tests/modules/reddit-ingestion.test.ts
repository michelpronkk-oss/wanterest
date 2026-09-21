import { describe, expect, it, vi } from "vitest";

import { redditChangedPost, redditCommentsResponse, redditSearchPageOne, redditStandalonePost, redditTokenResponse } from "../../src/server/providers/source/reddit/fixtures";
import { RedditSourceAdapter } from "../../src/server/providers/source/reddit";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine, InMemoryIntelligenceRepository, IntelligenceService } from "../../src/server/modules/intelligence";
import type { ProductRow } from "../../src/server/db/database.helpers";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Reddit ingestion pipeline", () => {
  it("stores raw posts/comments, canonicalizes them provider-neutrally, and replays without refetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response({ ...redditSearchPageOne, data: { ...redditSearchPageOne.data, children: [redditSearchPageOne.data.children[0], redditSearchPageOne.data.children[0]] } }))
      .mockResolvedValueOnce(response(redditCommentsResponse));
    const adapter = new RedditSourceAdapter({
      fetchImpl,
      clientId: "client-id",
      clientSecret: "client-secret",
      userAgent: "wanterest/test",
      apiBaseUrl: "https://oauth.test",
      authBaseUrl: "https://auth.test",
      backoffMs: 0,
    });
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["reddit", adapter]]));

    const discovery = await service.discoverSource("reddit", {
      query: "workflow",
      limit: 5,
      expandThreads: true,
      requestMetadata: { maxComments: 20, maxCommentDepth: 2 },
    });
    expect(discovery.rawInserted).toBe(4);
    expect(discovery.rawDuplicates).toBe(1);
    expect(repository.rawItems.size).toBe(4);
    const callsAfterDiscovery = fetchImpl.mock.calls.length;

    const replay = await service.replay({ sourceKey: "reddit", normalizationVersion: "reddit-v1", canonicalizationVersion: "canonical-v1" });
    expect(replay).toMatchObject({ rawItems: 4, normalized: 4, canonicalized: 4, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(callsAfterDiscovery);
    expect(repository.sourceItems.size).toBe(4);
    expect(repository.conversations.size).toBe(1);
    expect(repository.conversationSourceItems).toHaveLength(4);
    expect([...repository.sourceItems.values()].filter((row) => row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) && row.metadata.itemType === "comment")).toHaveLength(3);
    expect([...repository.conversations.values()][0]?.conversation_key).toContain("reddit:thread:t3_post1");

    const conversation = [...repository.conversations.values()][0]!;
    const source = [...repository.sourceItems.values()].find((row) => row.id === conversation.primary_source_item_id)!;
    const intelligenceRepository = new InMemoryIntelligenceRepository();
    const product: ProductRow = {
      id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      name: "Calmer workflow helper",
      slug: "calmer-workflow-helper",
      website_url: null,
      status: "active",
      current_snapshot_id: null,
      current_demand_profile_id: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };
    intelligenceRepository.products.set(product.id, product);
    intelligenceRepository.conversations.set(conversation.id, conversation);
    intelligenceRepository.sourceItems.set(source.id, source);
    const intelligence = new IntelligenceService(intelligenceRepository);
    const snapshot = await intelligence.createSnapshot(product, { pageType: "manual", rawText: "A calmer workflow helper for teams that need less noisy reporting and follow-up." });
    const profile = await intelligence.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const analysis = await intelligence.analyzeConversation(conversation, source, "99999999-9999-4999-8999-999999999999", new FixtureConversationAnalysisEngine());
    const evaluation = await intelligence.matchProduct(product, profile.id, analysis.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new FixtureProductMatchingEngine());
    const ranking = await intelligence.rankEvaluation(product, evaluation.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(ranking).not.toBeNull();
    if (!ranking) throw new Error("Expected qualified evaluation to rank.");
    const signal = await intelligence.materializeSignal(product, evaluation.id, ranking.id);
    expect(signal?.source_key).toBe("reddit");
    expect(signal?.conversation_id).toBe(conversation.id);
    expect(intelligenceRepository.provenance.some((edge) => edge.relationType === "ranks_match_evaluation")).toBe(true);
  });

  it("keeps changed provider payloads as raw versions while retaining one current source identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response({ kind: "Listing", data: { after: null, children: [redditStandalonePost] } }))
      .mockResolvedValueOnce(response({ kind: "Listing", data: { after: null, children: [redditChangedPost] } }));
    const adapter = new RedditSourceAdapter({
      fetchImpl,
      clientId: "client-id",
      clientSecret: "client-secret",
      userAgent: "wanterest/test",
      apiBaseUrl: "https://oauth.test",
      authBaseUrl: "https://auth.test",
      backoffMs: 0,
    });
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["reddit", adapter]]));
    await service.discoverSource("reddit", { query: "workflow", limit: 1, requestMetadata: {} });
    await service.discoverSource("reddit", { query: "workflow changed", limit: 1, requestMetadata: {} });
    expect(repository.rawItems.size).toBe(2);
    const replay = await service.replay({ sourceKey: "reddit", normalizationVersion: "reddit-v1", canonicalizationVersion: "canonical-v1" });
    expect(replay).toMatchObject({ rawItems: 2, normalized: 2, canonicalized: 2, failed: 0 });
    expect(repository.sourceItems.size).toBe(1);
    expect([...repository.sourceItems.values()][0]?.external_id).toBe("t3_post1");
  });
});
