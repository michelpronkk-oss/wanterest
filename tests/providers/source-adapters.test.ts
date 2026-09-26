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

describe("Hacker News source adapter - Search v2 (Algolia, Layer 12A.3A)", () => {
  function algoliaResponse(hits: unknown[], overrides: Record<string, unknown> = {}) {
    return response({ hits, page: 0, nbPages: 1, hitsPerPage: 20, ...overrides });
  }

  it("legacy behaviour is unchanged when executionMode is absent (flag-off request shape)", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([301]))
      .mockResolvedValueOnce(response({ id: 301, type: "story", title: "Unrelated", time: 1_758_284_800 }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, baseUrl: "https://hn.test/v0", algoliaBaseUrl: "https://hn.algolia.test/v1" });
    await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: {} });
    for (const call of fetchImpl.mock.calls) expect(String(call[0])).not.toContain("hn.algolia.test");
  });

  it("constructs a deterministic Algolia request: literal query, both tags, explicit freshness window, bounded pagination", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([]));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });

    await adapter.discover({
      query: "Jira alternative",
      limit: 10,
      expandThreads: false,
      windowStart: "2026-09-01T00:00:00.000Z",
      windowEnd: "2026-09-15T00:00:00.000Z",
      requestMetadata: { executionMode: "algolia_search_v2", maxPages: 1 },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://hn.algolia.test/v1/search_by_date");
    expect(url.searchParams.get("query")).toBe("Jira alternative");
    expect(url.searchParams.get("tags")).toBe("(story,comment)");
    expect(url.searchParams.get("numericFilters")).toBe(
      `created_at_i>${Math.floor(Date.parse("2026-09-01T00:00:00.000Z") / 1000)},created_at_i<${Math.floor(Date.parse("2026-09-15T00:00:00.000Z") / 1000)}`,
    );
    expect(url.searchParams.get("page")).toBe("0");
    expect(Number(url.searchParams.get("hitsPerPage"))).toBeLessThanOrEqual(20);
  });

  it("applies a default 14-day freshness window when no explicit window is given", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([]));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    const before = Date.now();
    await adapter.discover({ query: "alt", limit: 5, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    const [, gt] = /created_at_i>(\d+)/.exec(url.searchParams.get("numericFilters") ?? "") ?? [];
    expect(Number(gt) * 1000).toBeGreaterThan(before - 15 * 24 * 60 * 60 * 1000 - 5_000);
    expect(Number(gt) * 1000).toBeLessThan(before - 13 * 24 * 60 * 60 * 1000);
  });

  it("normalizes a story hit and a comment hit, resolving the comment to its root story without extra hydration calls", async () => {
    const storyHit = { objectID: "401", created_at_i: 1_758_284_800, title: "Show HN: thing", url: "https://example.com/thing", author: "alice", points: 10, num_comments: 2, _tags: ["story"] };
    const commentHit = { objectID: "402", created_at_i: 1_758_284_900, comment_text: "This is exactly the Jira alternative I needed.", story_id: 401, parent_id: 401, story_title: "Show HN: thing", story_url: "https://example.com/thing", author: "bob", _tags: ["comment", "story_401"] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([storyHit, commentHit]));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });

    const page = await adapter.discover({ query: "Jira alternative", limit: 10, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } });
    expect(page.items).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no Firebase hydration call - story_id already resolved the root

    const story = adapter.normalize(page.items[0]!);
    expect(story.externalConversationId).toBe("401");
    expect(story.metadata).toMatchObject({ providerType: "story", rootId: "401", matchedItemId: "401" });

    const comment = adapter.normalize(page.items[1]!);
    expect(comment.externalConversationId).toBe("401"); // same conversation root as the story - no duplicate thread
    expect(comment.body).toContain("Jira alternative");
    expect(comment.metadata).toMatchObject({ providerType: "comment", rootId: "401", parentId: "401", matchedItemId: "402" });
  });

  it("multiple relevant comments from the same thread canonicalize to one conversation id, not duplicates", async () => {
    const commentA = { objectID: "501", created_at_i: 1_758_284_900, comment_text: "First matching comment.", story_id: 999, _tags: ["comment"] };
    const commentB = { objectID: "502", created_at_i: 1_758_284_950, comment_text: "Second matching comment.", story_id: 999, parent_id: 501, _tags: ["comment"] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([commentA, commentB]));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    const page = await adapter.discover({ query: "alt", limit: 10, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } });
    const ids = page.items.map((item) => adapter.normalize(item).externalConversationId);
    expect(new Set(ids)).toEqual(new Set(["999"]));
  });

  it("excludes empty-text hits", async () => {
    const empty = { objectID: "601", created_at_i: 1_758_284_800, title: "", story_text: null, _tags: ["story"] };
    const usable = { objectID: "602", created_at_i: 1_758_284_800, title: "Real title", _tags: ["story"] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([empty, usable]));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    const page = await adapter.discover({ query: "x", limit: 10, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.externalId).toBe("602");
    expect(page.diagnostics.rejected).toBe(1);
  });

  it("respects bounded pagination via the returned cursor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([{ objectID: "1", created_at_i: 1, title: "a", _tags: ["story"] }], { page: 0, nbPages: 5 }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    const page = await adapter.discover({ query: "x", limit: 100, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2", maxPages: 1 } });
    expect(page.nextCursor).toBe("algolia-page:1");

    const fetchImpl2 = vi.fn<typeof fetch>().mockResolvedValueOnce(algoliaResponse([], { page: 1, nbPages: 5 }));
    const adapter2 = new HackerNewsSourceAdapter({ fetchImpl: fetchImpl2, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    await adapter2.discover({ query: "x", limit: 100, cursor: page.nextCursor, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2", maxPages: 1 } });
    const url2 = new URL(String(fetchImpl2.mock.calls[0]![0]));
    expect(url2.searchParams.get("page")).toBe("1");
  });

  it("classifies 429 as retryable RATE_LIMITED and retries within the attempt bound", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "rate limited" }, 429));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1", maxAttempts: 2 });
    await expect(adapter.discover({ query: "x", limit: 1, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies a 5xx as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "boom" }, 503));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1", maxAttempts: 2 });
    await expect(adapter.discover({ query: "x", limit: 1, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } })).rejects.toMatchObject({ code: "HTTP_503", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies a 4xx as non-retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "bad request" }, 400));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1", maxAttempts: 2 });
    await expect(adapter.discover({ query: "x", limit: 1, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } })).rejects.toMatchObject({ code: "HTTP_400", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a timeout as retryable REQUEST_FAILED", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1", timeoutMs: 5, maxAttempts: 2 });
    await expect(adapter.discover({ query: "x", limit: 1, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } })).rejects.toMatchObject({ code: "REQUEST_FAILED", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws MALFORMED_PROVIDER_PAYLOAD for a malformed response body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ notHits: true }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, algoliaBaseUrl: "https://hn.algolia.test/v1" });
    await expect(adapter.discover({ query: "x", limit: 1, expandThreads: false, requestMetadata: { executionMode: "algolia_search_v2" } })).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_PAYLOAD" });
  });

  it("healthCheck still uses the Firebase endpoint (unchanged)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: 1, type: "story" }));
    const adapter = new HackerNewsSourceAdapter({ fetchImpl, baseUrl: "https://hn.test/v0", algoliaBaseUrl: "https://hn.algolia.test/v1" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("hn.test/v0/item/1.json");
  });
});
