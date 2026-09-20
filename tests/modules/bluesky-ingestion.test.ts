import { describe, expect, it, vi } from "vitest";

import {
  blueskyPageTwo,
  blueskyQuotePost,
  blueskyReplyPost,
  blueskyStandalonePost,
} from "../../src/server/providers/source/bluesky/fixtures";
import { BlueskySourceAdapter } from "../../src/server/providers/source/bluesky";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Bluesky ingestion pipeline", () => {
  it("persists raw payloads idempotently and replays into root, reply, and quote conversations", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ posts: [blueskyStandalonePost, blueskyStandalonePost, blueskyReplyPost, blueskyQuotePost] }))
      .mockResolvedValueOnce(response(blueskyPageTwo));
    const adapter = new BlueskySourceAdapter({ fetchImpl });
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["bluesky", adapter]]));

    const discovery = await service.discoverSource("bluesky", { query: "workflow", limit: 10 });
    expect(discovery.rawInserted).toBe(3);
    expect(discovery.rawDuplicates).toBe(1);
    expect(repository.rawItems.size).toBe(3);

    const replay = await service.replay({
      sourceKey: "bluesky",
      normalizationVersion: "bluesky-v1",
      canonicalizationVersion: "canonical-v1",
    });

    expect(replay).toMatchObject({ rawItems: 3, normalized: 3, canonicalized: 3, failed: 0 });
    expect(repository.sourceItems.size).toBe(3);
    expect(repository.conversations.size).toBe(2);
    expect(repository.conversationSourceItems).toHaveLength(3);
    expect(repository.provenance.length).toBeGreaterThanOrEqual(6);
    expect([...repository.conversations.values()].some((row) => row.conversation_key.includes(blueskyStandalonePost.uri))).toBe(true);
    expect([...repository.conversations.values()].some((row) => row.conversation_key.includes(blueskyQuotePost.uri))).toBe(true);
    expect([...repository.conversations.values()].every((row) => row.conversation_key !== blueskyReplyPost.uri)).toBe(true);
  });

  it("stores changed raw payload versions without changing the stable source identity", async () => {
    const changed = { ...blueskyStandalonePost, cid: "bafyreichanged", record: { ...blueskyStandalonePost.record, text: "A changed payload." } };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ posts: [blueskyStandalonePost] }))
      .mockResolvedValueOnce(response({ posts: [changed] }));
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["bluesky", new BlueskySourceAdapter({ fetchImpl })]]));

    await service.discoverSource("bluesky", { query: "workflow", limit: 1 });
    await service.discoverSource("bluesky", { query: "workflow changed", limit: 1 });
    expect(repository.rawItems.size).toBe(2);
    const replay = await service.replay({ sourceKey: "bluesky", normalizationVersion: "bluesky-v1", canonicalizationVersion: "canonical-v1" });

    expect(replay).toMatchObject({ rawItems: 2, normalized: 2, canonicalized: 2, failed: 0 });
    expect(repository.sourceItems.size).toBe(1);
    expect(repository.conversations.size).toBe(1);
    expect([...repository.sourceItems.values()][0]?.external_id).toBe(blueskyStandalonePost.uri);
  });
});
