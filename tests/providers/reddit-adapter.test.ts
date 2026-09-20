import { describe, expect, it, vi } from "vitest";

import {
  redditCommentsResponse,
  redditCrosspost,
  redditLinkPost,
  redditSearchPageOne,
  redditSearchPageTwo,
  redditStandalonePost,
  redditUnauthorizedResponse,
  redditRateLimitedResponse,
  redditServerErrorResponse,
  redditTokenResponse,
} from "../../src/server/providers/source/reddit/fixtures";
import { RedditSourceAdapter } from "../../src/server/providers/source/reddit";
import { RedditTokenManager } from "../../src/server/providers/source/reddit/reddit.auth";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function configured(fetchImpl: typeof fetch) {
  return new RedditSourceAdapter({
    fetchImpl,
    clientId: "client-id",
    clientSecret: "client-secret",
    userAgent: "wanterest/test",
    apiBaseUrl: "https://oauth.test",
    authBaseUrl: "https://auth.test",
    backoffMs: 0,
  });
}

describe("Reddit source adapter", () => {
  it("uses the official OAuth/Data API shape and preserves opaque after cursors", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response(redditSearchPageOne, 200, {
        "x-ratelimit-remaining": "99.5",
        "x-ratelimit-limit": "100",
        "x-ratelimit-reset": "60",
      }))
      .mockResolvedValueOnce(response(redditSearchPageTwo));
    const adapter = configured(fetchImpl);

    const first = await adapter.discover({ query: "workflow", limit: 100, expandThreads: false, requestMetadata: {} });
    expect(first.nextCursor).toMatch(/^reddit:v1:/);
    expect(first.items).toHaveLength(3);
    expect(first.diagnostics.rejected).toBeGreaterThan(0);
    expect(first.rateLimit).toMatchObject({ provider: "reddit-data-api", remaining: 99, limit: 100 });
    expect(first.rateLimit?.resetAt).toBeTruthy();

    const firstApiUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(firstApiUrl.origin).toBe("https://oauth.test");
    expect(firstApiUrl.pathname).toBe("/search");
    expect(firstApiUrl.searchParams.get("q")).toBe("workflow");
    expect(firstApiUrl.searchParams.get("limit")).toBe("100");
    expect(firstApiUrl.searchParams.get("type")).toBe("link");
    expect(firstApiUrl.searchParams.get("after")).toBeNull();
    expect(firstApiUrl.searchParams.get("raw_json")).toBe("1");

    await adapter.discover({ query: "workflow", limit: 10, cursor: first.nextCursor, expandThreads: false, requestMetadata: {} });
    const secondApiUrl = new URL(String(fetchImpl.mock.calls[2]?.[0]));
    expect(secondApiUrl.searchParams.get("after")).toBe("t3_link2");
    expect(secondApiUrl.pathname).toBe("/search");
  });

  it("supports safe subreddit-scoped search and bounded comment expansion", async () => {
    const nested = {
      ...redditCommentsResponse[1] as { kind: string; data: { children: unknown[] } },
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: "parent",
              name: "t1_parent",
              body: "parent",
              author: "alice",
              parent_id: "t3_post1",
              link_id: "t3_post1",
              subreddit: "startups",
              depth: 0,
              replies: { kind: "Listing", data: { children: [{ kind: "t1", data: { id: "child", name: "t1_child", body: "child", author: "bob", parent_id: "t1_parent", link_id: "t3_post1", subreddit: "startups", depth: 1 } }] } },
            },
          },
          { kind: "more", data: { children: [] } },
        ],
      },
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response({ kind: "Listing", data: { after: null, children: [redditStandalonePost] } }))
      .mockResolvedValueOnce(response([redditCommentsResponse[0], nested]));
    const adapter = configured(fetchImpl);

    const page = await adapter.discover({
      query: "workflow",
      limit: 5,
      expandThreads: true,
      requestMetadata: { subreddit: "startups", maxComments: 2, maxCommentDepth: 1 },
    });
    expect(adapter.capabilities).toMatchObject({ supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true });
    expect(page.items).toHaveLength(3);
    expect(page.items.slice(1).every((item) => item.cursorContext.rootFullname === "t3_post1")).toBe(true);
    const searchUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(searchUrl.pathname).toBe("/r/startups/search");
    expect(searchUrl.searchParams.get("restrict_sr")).toBe("true");
    const commentsUrl = new URL(String(fetchImpl.mock.calls[2]?.[0]));
    expect(commentsUrl.pathname).toBe("/comments/post1");
    expect(commentsUrl.searchParams.get("limit")).toBe("2");
    expect(commentsUrl.searchParams.get("depth")).toBe("1");
  });

  it("normalizes posts and comments with stable fullname and thread identities", async () => {
    const adapter = configured(vi.fn<typeof fetch>());
    const post = adapter.normalize({
      sourceKey: "reddit",
      externalId: "t3_link1",
      fetchedAt: "2026-09-20T10:00:00.000Z",
      payload: redditLinkPost,
      requestMetadata: {},
      cursorContext: { rootFullname: "t3_link1" },
    });
    const comment = adapter.normalize({
      sourceKey: "reddit",
      externalId: "t1_comment1",
      fetchedAt: "2026-09-20T10:00:00.000Z",
      payload: redditCommentsResponse[1] && { kind: "t1", data: {
        id: "comment1", name: "t1_comment1", body: "Useful detail", author: "alice", parent_id: "t3_link1", link_id: "t3_link1", permalink: "/r/startups/comments/link1/comment1/", created_utc: 1789812120,
      } },
      requestMetadata: {},
      cursorContext: { rootFullname: "t3_link1" },
    });
    expect(post.externalId).toBe("t3_link1");
    expect(post.externalConversationId).toBe("t3_link1");
    expect(post.canonicalUrl).toBe("https://www.reddit.com/r/Entrepreneur/comments/link1/a_useful_operations_tool/");
    expect(comment.externalId).toBe("t1_comment1");
    expect(comment.externalConversationId).toBe("t3_link1");
    expect(comment.body).toBe("Useful detail");

    const crosspost = adapter.normalize({
      sourceKey: "reddit",
      externalId: "t3_cross1",
      fetchedAt: "2026-09-20T10:00:00.000Z",
      payload: redditCrosspost,
      requestMetadata: {},
      cursorContext: { rootFullname: "t3_cross1" },
    });
    expect(crosspost.externalId).toBe("t3_cross1");
    expect(crosspost.externalConversationId).toBe("t3_cross1");
    expect(crosspost.metadata).toMatchObject({ crosspostParent: "t3_post1" });
  });

  it("caches tokens, refreshes after expiry, and never calls the provider when unconfigured", async () => {
    let now = new Date("2026-09-20T10:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response(redditTokenResponse));
    const manager = new RedditTokenManager({
      fetchImpl,
      clientId: "client-id",
      clientSecret: "client-secret",
      userAgent: "wanterest/test",
      authBaseUrl: "https://auth.test",
      clock: () => now,
      backoffMs: 0,
    });
    await manager.getAccessToken();
    await manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 3_600_000);
    await manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const missing = new RedditTokenManager({ fetchImpl: vi.fn<typeof fetch>() });
    await expect(missing.getAccessToken()).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  it("maps provider failures to typed errors without retrying forbidden access", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response({ message: "forbidden" }, 403));
    const adapter = configured(fetchImpl);
    await expect(adapter.discover({ query: "workflow", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries bounded transient failures and reports auth, rate-limit, server, and timeout errors", async () => {
    const authFailure = vi.fn<typeof fetch>().mockResolvedValueOnce(response(redditUnauthorizedResponse, 401));
    await expect(new RedditTokenManager({ clientId: "id", clientSecret: "secret", userAgent: "wanterest/test", fetchImpl: authFailure, backoffMs: 0 }).getAccessToken()).rejects.toMatchObject({ code: "AUTH_FAILED", retryable: false });

    const rateLimited = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response(redditRateLimitedResponse, 429))
      .mockResolvedValueOnce(response(redditRateLimitedResponse, 429));
    await expect(configured(rateLimited).discover({ query: "workflow", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(rateLimited).toHaveBeenCalledTimes(3);

    const serverError = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response(redditServerErrorResponse, 503))
      .mockResolvedValueOnce(response(redditServerErrorResponse, 503));
    await expect(configured(serverError).discover({ query: "workflow", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "HTTP_503", retryable: true });
    expect(serverError).toHaveBeenCalledTimes(3);

    const timeout = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockRejectedValueOnce(new DOMException("timed out", "AbortError"))
      .mockRejectedValueOnce(new DOMException("timed out", "AbortError"));
    await expect(configured(timeout).discover({ query: "workflow", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(timeout).toHaveBeenCalledTimes(3);
  });

  it("reports an unconfigured health state without making a provider request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new RedditSourceAdapter({ clientId: "", clientSecret: "", userAgent: "", fetchImpl });
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false, errorCode: "AUTH_NOT_CONFIGURED", degradationState: "degraded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retrieves a public post by stable fullname through the official listing endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(redditTokenResponse))
      .mockResolvedValueOnce(response({ kind: "Listing", data: { children: [redditStandalonePost] } }));
    const adapter = configured(fetchImpl);
    const client = (adapter as unknown as { client: { getPost: (id: string) => Promise<{ post: unknown }> } }).client;
    const result = await client.getPost("post1");
    expect(result.post).toMatchObject({ kind: "t3" });
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).pathname).toBe("/by_id/t3_post1");
  });
});
