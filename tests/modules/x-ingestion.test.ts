import { describe, expect, it, vi } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { XSourceAdapter } from "../../src/server/providers/source/x";
import { xDuplicatePost, xPageOne, xStandalonePost } from "../../src/server/providers/source/x/fixtures";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("X ingestion pipeline", () => {
  it("stores raw X posts and replays root, reply, and quote identities through provider-neutral canonicalization", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...xPageOne, data: [xDuplicatePost, ...xPageOne.data] }));
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["x", new XSourceAdapter({ fetchImpl, token: "test-token" })]]));

    const discovery = await service.discoverSource("x", { query: "workflow", limit: 10, requestMetadata: {} });
    expect(discovery.rawInserted).toBe(3);
    expect(repository.rawItems.size).toBe(3);

    const replay = await service.replay({ sourceKey: "x", normalizationVersion: "x-v1", canonicalizationVersion: "canonical-v1" });
    expect(replay).toMatchObject({ rawItems: 3, normalized: 3, canonicalized: 3, failed: 0 });
    expect(repository.sourceItems.size).toBe(3);
    expect(repository.conversations.size).toBe(2);
    expect(repository.provenance.length).toBeGreaterThanOrEqual(6);
    expect([...repository.conversations.values()].some((row) => row.conversation_key.includes(xStandalonePost.id))).toBe(true);
    expect([...repository.conversations.values()].filter((row) => row.conversation_key.includes(xStandalonePost.id))).toHaveLength(1);
  });

  it("keeps raw payload versions while retaining stable X source identity on edits", async () => {
    const changed = { ...xStandalonePost, text: "Updated workflow request.", edit_history_tweet_ids: [xStandalonePost.id, "1900000000000000099"] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [xStandalonePost], includes: { users: [] }, meta: { result_count: 1 } }))
      .mockResolvedValueOnce(response({ data: [changed], includes: { users: [] }, meta: { result_count: 1 } }));
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["x", new XSourceAdapter({ fetchImpl, token: "test-token" })]]));

    await service.discoverSource("x", { query: "workflow", limit: 10, requestMetadata: {} });
    await service.discoverSource("x", { query: "workflow changed", limit: 10, requestMetadata: {} });
    const replay = await service.replay({ sourceKey: "x", normalizationVersion: "x-v1", canonicalizationVersion: "canonical-v1" });

    expect(repository.rawItems.size).toBe(2);
    expect(replay.failed).toBe(0);
    expect(repository.sourceItems.size).toBe(1);
    expect([...repository.sourceItems.values()][0]?.external_id).toBe(xStandalonePost.id);
  });
});
