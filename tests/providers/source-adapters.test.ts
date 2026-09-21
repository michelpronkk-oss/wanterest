import { describe, expect, it, vi } from "vitest";

import { HackerNewsSourceAdapter } from "../../src/server/providers/source/hacker-news";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("Hacker News source adapter", () => {
  it("uses the shared contract and preserves root/thread identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([101, 102]))
      .mockResolvedValueOnce(response({ id: 101, type: "story", title: "Root", text: "Root text", by: "alice", time: 1_758_284_800, kids: [102] }))
      .mockResolvedValueOnce(response({ id: 102, type: "comment", text: "Reply", by: "bob", time: 1_758_284_900, parent: 101 }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, baseUrl: "https://hn.test/v0" });

    const page = await adapter.discover({ limit: 2, expandThreads: true, requestMetadata: {} });
    expect(page.items).toHaveLength(2);
    const candidate = adapter.normalize(page.items[1]!);
    expect(candidate.externalConversationId).toBe("101");
    expect(candidate.authorExternalId).toBe("bob");
    expect(candidate.metadata).toMatchObject({ parentId: "101", rootId: "101" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not leak provider failures as raw diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "rate limited" }, 429));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, baseUrl: "https://hn.test/v0", maxAttempts: 2 });
    await expect(adapter.discover({ limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("filters the bounded recent feed using product anchors instead of admitting unrelated stories", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([201, 202]))
      .mockResolvedValueOnce(response({ id: 201, type: "story", title: "A poem about convenience", time: 1_758_284_800 }))
      .mockResolvedValueOnce(response({ id: 202, type: "story", title: "Jira alternative for small teams", text: "Comparing issue trackers", time: 1_758_284_900 }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, baseUrl: "https://hn.test/v0" });

    const page = await adapter.discover({
      query: "Jira alternative",
      limit: 1,
      requestMetadata: { lexicalAnchors: ["Jira"] },
      expandThreads: false,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.externalId).toBe("202");
    expect(page.diagnostics.rejected).toBe(1);
    expect(page.diagnostics.messages[0]).toContain("bounded lexical anchors");
  });
});
