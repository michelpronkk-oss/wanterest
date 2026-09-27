import { describe, expect, it, vi } from "vitest";

import { DevtoSourceAdapter } from "../../src/server/providers/source/devto";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";

function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

describe("DEV/Forem ingestion pipeline", () => {
  it("persists public article and comment evidence idempotently into one conversation", async () => {
    const article = { id: 7, title: "Need a better workflow", description: "I need an alternative workflow.", body_markdown: "The current workflow is painful.", url: "https://dev.to/alice/better-workflow", published_at: "2026-09-20T10:00:00Z", comments_count: 1, user: { user_id: 1, username: "alice", name: "Alice" } };
    const comment = [{ id_code: "m7", created_at: "2026-09-20T11:00:00Z", body_html: "<p>I switched too.</p>", user: { user_id: 2, username: "bob", name: "Bob" }, children: [] }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response([article])).mockResolvedValueOnce(response(comment));
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["devto", new DevtoSourceAdapter({ fetchImpl })]]));

    const discovery = await service.discoverSource("devto", { query: "workflow alternative", limit: 5, expandThreads: false, requestMetadata: { queryPlanVersion: "query_planning_v8", includeComments: true, maxCommentsPerArticle: 8 } });
    expect(discovery.rawInserted).toBe(2);
    const replay = await service.replay({ sourceKey: "devto", normalizationVersion: "devto-v1", canonicalizationVersion: "canonical-v1" });
    expect(replay).toMatchObject({ rawItems: 2, normalized: 2, canonicalized: 2, failed: 0 });
    expect(repository.conversations.size).toBe(1);
    expect(repository.sourceItems.size).toBe(2);
    expect(repository.conversationSourceItems).toHaveLength(2);
    expect([...repository.sourceItems.values()].find((item) => item.external_id.includes("comment:m7"))?.external_conversation_id).toContain("article:7");
    expect(repository.provenance.length).toBeGreaterThanOrEqual(4);
  });
});
