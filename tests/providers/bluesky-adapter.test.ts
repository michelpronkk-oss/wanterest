import { describe, expect, it, vi } from "vitest";

import {
  blueskyChangedPost,
  blueskyMalformedPost,
  blueskyMultiLanguagePost,
  blueskyPageOne,
  blueskyQuotePost,
  blueskyReplyPost,
  blueskyStandalonePost,
} from "../../src/server/providers/source/bluesky/fixtures";
import { BlueskySourceAdapter } from "../../src/server/providers/source/bluesky";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function envelope(payload: unknown, externalId = "test") {
  return {
    sourceKey: "bluesky",
    externalId,
    fetchedAt: "2026-09-20T10:00:00.000Z",
    payload,
    requestMetadata: {},
    cursorContext: {},
  };
}

describe("Bluesky source adapter", () => {
  it("uses public AppView first-page search with bounded and encoded query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ posts: [], cursor: "next" }));
    const adapter = new BlueskySourceAdapter({ fetchImpl, clock: () => new Date("2026-09-20T10:00:00.000Z") });

    const page = await adapter.discover({
      query: "CRM & automation",
      limit: 100,
      windowStart: "2026-09-19T00:00:00.000Z",
      windowEnd: "2026-09-20T00:00:00.000Z",
      requestMetadata: { langs: ["en"], sort: "latest", tag: "saas" },
      expandThreads: false,
    });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requested.origin).toBe("https://api.bsky.app");
    expect(requested.pathname).toBe("/xrpc/app.bsky.feed.searchPosts");
    expect(requested.searchParams.get("q")).toBe("CRM & automation");
    expect(requested.searchParams.get("limit")).toBe("20");
    expect(requested.searchParams.has("cursor")).toBe(false);
    expect(requested.searchParams.get("since")).toBe("2026-09-19");
    expect(requested.searchParams.get("until")).toBe("2026-09-20");
    expect(requested.searchParams.get("lang")).toBe("en");
    expect(requested.searchParams.get("tag")).toBe("saas");
    expect(page.nextCursor).toBeUndefined();
    expect(page.diagnostics.messages).toContain("provider cursor returned but withheld: api.bsky.app cursor pagination is disabled for V1");
    expect(adapter.capabilities).toEqual({ supportsSearch: true, supportsIncrementalCursor: false, supportsThreadExpansion: false });
  });

  it("skips malformed records while retaining valid records and diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ posts: [blueskyStandalonePost, blueskyMalformedPost] }));
    const adapter = new BlueskySourceAdapter({ fetchImpl });

    const page = await adapter.discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false });

    expect(page.items).toHaveLength(1);
    expect(page.diagnostics).toMatchObject({ accepted: 1, rejected: 1 });
    expect(page.diagnostics.messages[0]).toContain("malformed Bluesky post");
  });

  it("normalizes stable identity, author, timestamps, language, and engagement metadata", () => {
    const adapter = new BlueskySourceAdapter();
    const candidate = adapter.normalize(envelope(blueskyStandalonePost, blueskyStandalonePost.uri));

    expect(candidate).toMatchObject({
      sourceKey: "bluesky",
      externalId: blueskyStandalonePost.uri,
      externalConversationId: blueskyStandalonePost.uri,
      canonicalUrl: "https://bsky.app/profile/alice.example/post/standalone1",
      authorExternalId: "did:plc:alice123",
      authorDisplayName: "Alice Example",
      language: "en",
      publishedAt: "2026-09-19T10:00:00.000Z",
      body: "Looking for a calmer CRM workflow.",
    });
    expect(candidate.metadata).toMatchObject({
      did: "did:plc:alice123",
      handle: "alice.example",
      cid: "bafyreistandalone1",
      likeCount: 4,
      replyCount: 2,
    });
  });

  it("maps replies to the root conversation and keeps quotes in their own conversation", () => {
    const adapter = new BlueskySourceAdapter();
    const reply = adapter.normalize(envelope(blueskyReplyPost, blueskyReplyPost.uri));
    const quote = adapter.normalize(envelope(blueskyQuotePost, blueskyQuotePost.uri));

    expect(reply.externalConversationId).toBe(blueskyStandalonePost.uri);
    expect(reply.metadata).toMatchObject({ replyRootUri: blueskyStandalonePost.uri, replyParentUri: blueskyStandalonePost.uri });
    expect(quote.externalConversationId).toBe(blueskyQuotePost.uri);
    expect(quote.metadata).toMatchObject({ quoteUri: blueskyStandalonePost.uri, quoteCid: blueskyStandalonePost.cid });
  });

  it("allows missing display names, preserves multiple languages, and changes raw versions", () => {
    const adapter = new BlueskySourceAdapter();
    const missing = adapter.normalize(envelope({ ...blueskyStandalonePost, author: { did: "did:plc:alice123", handle: "alice.example" } }, "missing"));
    const multilingual = adapter.normalize(envelope(blueskyMultiLanguagePost, blueskyMultiLanguagePost.uri));
    const changed = adapter.normalize(envelope(blueskyChangedPost, blueskyChangedPost.uri));

    expect(missing.authorDisplayName).toBeUndefined();
    expect(multilingual.language).toBe("en");
    expect(multilingual.metadata).toMatchObject({ langs: ["en", "de"] });
    expect(changed.body).toBe("Updated CRM workflow request.");
    expect(changed.externalId).toBe(blueskyStandalonePost.uri);
  });

  it("withholds provider cursors and rejects additional-page discovery", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(blueskyPageOne));
    const adapter = new BlueskySourceAdapter({ fetchImpl });

    const first = await adapter.discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false });

    expect(first.items).toHaveLength(3);
    expect(first.diagnostics.rejected).toBe(1);
    expect(first.nextCursor).toBeUndefined();
    expect(first.items[0]?.requestMetadata).toMatchObject({ providerCursor: "bluesky-cursor-page-two" });
    await expect(adapter.discover({ query: "workflow", limit: 10, cursor: "provider-cursor", requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "PAGINATION_UNAVAILABLE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries rate limits and server errors with typed failures", async () => {
    const rateLimited = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "slow down" }, 429, { "retry-after": "2" }));
    await expect(new BlueskySourceAdapter({ fetchImpl: rateLimited, maxAttempts: 2 }).discover({ query: "workflow", limit: 1, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(rateLimited).toHaveBeenCalledTimes(2);

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "unavailable" }, 503));
    await expect(new BlueskySourceAdapter({ fetchImpl: unavailable, maxAttempts: 2 }).discover({ query: "workflow", limit: 1, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "HTTP_503", retryable: true });
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it("reports timeouts and health status", async () => {
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const adapter = new BlueskySourceAdapter({ fetchImpl: timeout, maxAttempts: 2 });
    await expect(adapter.discover({ query: "workflow", limit: 1, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(timeout).toHaveBeenCalledTimes(2);

    const healthy = new BlueskySourceAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ posts: [] })) });
    await expect(healthy.healthCheck()).resolves.toMatchObject({ sourceKey: "bluesky", ok: true, degradationState: "healthy" });
  });

  it("requires caller-owned queries and does not pretend to expand threads", async () => {
    const adapter = new BlueskySourceAdapter({ fetchImpl: vi.fn<typeof fetch>() });
    await expect(adapter.discover({ limit: 1, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "QUERY_REQUIRED" });
    await expect(adapter.discover({ query: "workflow", limit: 1, requestMetadata: {}, expandThreads: true })).rejects.toMatchObject({ code: "THREAD_EXPANSION_UNSUPPORTED" });
  });
});
