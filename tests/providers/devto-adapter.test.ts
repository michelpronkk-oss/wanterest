import { describe, expect, it, vi } from "vitest";

import { DevtoSourceAdapter } from "../../src/server/providers/source/devto";

const article = {
  type_of: "article",
  id: 101,
  title: "Looking for a calmer project workflow",
  description: "I need an alternative to our current planning tool because the workflow is painful.",
  body_markdown: "We are looking for a better workflow and feature support.",
  tag_list: ["productivity", "discuss"],
  slug: "calmer-project-workflow-abc1",
  path: "/alice/calmer-project-workflow-abc1",
  url: "https://dev.to/alice/calmer-project-workflow-abc1",
  published_at: "2026-09-20T10:00:00Z",
  edited_at: "2026-09-20T11:00:00Z",
  last_comment_at: "2026-09-20T12:00:00Z",
  comments_count: 2,
  public_reactions_count: 4,
  user: { user_id: 44, name: "Alice", username: "alice" },
};

const comments = [
  { type_of: "comment", id_code: "m1", created_at: "2026-09-20T12:00:00Z", body_html: "<p>I switched from the old workflow and this is the missing feature.</p>", user: { user_id: 45, name: "Bob", username: "bob" }, children: [{ type_of: "comment", id_code: "m2", created_at: "2026-09-20T12:05:00Z", body_html: "<p>Same pain here.</p>", user: { user_id: 46, name: "Cara", username: "cara" }, children: [] } ] },
];

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("DEV/Forem source adapter", () => {
  it("uses public bounded search and depth endpoints with planner metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([article], 200, { "x-ratelimit-remaining": "9" }))
      .mockResolvedValueOnce(response(comments));
    const adapter = new DevtoSourceAdapter({ fetchImpl, backoffMs: 0, clock: () => new Date("2026-09-21T00:00:00Z") });

    const page = await adapter.discover({ query: "project workflow alternative", limit: 10, expandThreads: false, requestMetadata: { queryPlanVersion: "query_planning_v8", includeComments: true, maxPages: 2, maxArticlesToExpand: 4, maxCommentsPerArticle: 8 } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const searchUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(searchUrl.origin).toBe("https://dev.to");
    expect(searchUrl.pathname).toBe("/api/articles/search");
    expect(searchUrl.searchParams.get("q")).toBe("project workflow alternative");
    expect(searchUrl.searchParams.get("page")).toBe("1");
    expect(searchUrl.searchParams.get("per_page")).toBe("10");
    const commentUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(commentUrl.pathname).toBe("/api/comments");
    expect(commentUrl.searchParams.get("a_id")).toBe("101");
    expect(page.items.map((item) => item.externalId)).toEqual(["devto:dev.to:article:101", "devto:dev.to:comment:m1", "devto:dev.to:comment:m2"]);
    expect(page.providerMetrics).toMatchObject({ devToV1: { searchResults: 1, articlesAccepted: 1, depthEligible: 1, depthExpanded: 1, depthRequests: 1, commentsLoaded: 2, commentsPersisted: 2, dropped: 0 } });
    expect(page.items[0]?.requestMetadata.queryPlanVersion).toBe("query_planning_v8");
  });

  it("keeps one article conversation while preserving author and parent identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([article]));
    const adapter = new DevtoSourceAdapter({ fetchImpl });
    const page = await adapter.discover({ query: "workflow", limit: 5, expandThreads: false, requestMetadata: { includeComments: false } });
    const candidate = adapter.normalize(page.items[0]!);
    expect(candidate).toMatchObject({ sourceKey: "devto", externalId: "devto:dev.to:article:101", externalConversationId: "devto:dev.to:article:101", authorExternalId: "devto:user:44", publishedAt: "2026-09-20T10:00:00.000Z", body: article.body_markdown });
    expect(candidate.metadata).toMatchObject({ instance: "dev.to", articleId: 101, sourceCategory: "practitioner_article", lastCommentAt: "2026-09-20T12:00:00.000Z" });
  });

  it("normalizes nested comments as message-level evidence, not new conversations", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([article]))
      .mockResolvedValueOnce(response(comments));
    const adapter = new DevtoSourceAdapter({ fetchImpl });
    const page = await adapter.discover({ query: "workflow", limit: 5, expandThreads: false, requestMetadata: { includeComments: true, maxCommentsPerArticle: 8 } });
    const child = adapter.normalize(page.items[2]!);
    expect(child.externalId).toBe("devto:dev.to:comment:m2");
    expect(child.externalConversationId).toBe("devto:dev.to:article:101");
    expect(child.metadata).toMatchObject({ parentCommentId: "m1", rootExternalId: "devto:dev.to:article:101", commentId: "m2" });
    expect(child.authorExternalId).toBe("devto:user:46");
  });

  it("does not expand generic articles without deterministic demand context", async () => {
    const generic = { ...article, title: "A tutorial about JavaScript", description: "A generic tutorial", body_markdown: "Step one. Step two.", comments_count: 4 };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([generic]));
    const adapter = new DevtoSourceAdapter({ fetchImpl });
    const page = await adapter.discover({ query: "JavaScript", limit: 5, expandThreads: false, requestMetadata: { includeComments: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(page.items).toHaveLength(1);
    expect(page.providerMetrics).toMatchObject({ devToV1: { depthEligible: 0, depthExpanded: 0, depthRequests: 0 } });
  });

  it("applies temporal bounds and retries public rate limits without changing identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: "rate limited" }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(response([article]));
    const adapter = new DevtoSourceAdapter({ fetchImpl, backoffMs: 0, maxAttempts: 2 });
    const page = await adapter.discover({ query: "workflow", limit: 5, windowStart: "2026-09-19T00:00:00.000Z", windowEnd: "2026-09-21T00:00:00.000Z", expandThreads: false, requestMetadata: { includeComments: false } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(page.items[0]?.externalId).toBe("devto:dev.to:article:101");
  });
});
