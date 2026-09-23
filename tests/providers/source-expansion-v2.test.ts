import { describe, expect, it, vi } from "vitest";

import { GitLabSourceAdapter } from "../../src/server/providers/source/gitlab";
import { YouTubeSourceAdapter } from "../../src/server/providers/source/youtube";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const youtubeSearch = {
  items: [
    { id: { kind: "youtube#video", videoId: "video-1" }, snippet: { title: "Workflow alternatives", description: "A review", channelId: "channel-1", channelTitle: "Workflow Lab", publishedAt: "2026-09-20T10:00:00Z" } },
    { id: { kind: "youtube#video", videoId: "video-1" }, snippet: { title: "Duplicate", channelId: "channel-1", channelTitle: "Workflow Lab", publishedAt: "2026-09-20T10:00:00Z" } },
    { id: { kind: "youtube#video", videoId: "video-2" }, snippet: { title: "Migration discussion", description: "Switching tools", channelId: "channel-2", channelTitle: "Dev Signals", publishedAt: "2026-09-19T10:00:00Z" } },
  ],
};

describe("Source Expansion v2 adapters", () => {
  it("skips YouTube when the API key is missing", async () => {
    const adapter = new YouTubeSourceAdapter({ apiKey: "" });
    await expect(adapter.discover({ query: "tool alternative", limit: 2, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false, errorCode: "MISSING_CREDENTIALS" });
  });

  it("bounds YouTube search/comments, normalizes comments, and deduplicates comment IDs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) return response(youtubeSearch);
      const videoId = url.searchParams.get("videoId");
      const comment = (id: string, snippet: Record<string, unknown>) => ({ id: `thread-${id}`, snippet: { videoId, totalReplyCount: 1, topLevelComment: { id, snippet: { videoId, ...snippet } } } });
      return response({ items: videoId === "video-1" ? [
        comment("comment-1", { authorDisplayName: "Sam", authorChannelId: { value: "author-1" }, textDisplay: "I switched from Jira because it got too expensive.", publishedAt: "2026-09-21T10:00:00Z", updatedAt: "2026-09-21T10:01:00Z", likeCount: 4 }),
        comment("comment-1", { textDisplay: "duplicate" }),
        comment("comment-generic", { authorDisplayName: "Viewer", textDisplay: "Great video", publishedAt: "2026-09-21T11:00:00Z", likeCount: 20 }),
      ] : [
        comment("comment-2", { parentId: "comment-1", textDisplay: "Does this support SSO?", publishedAt: "2026-09-20T11:00:00Z", likeCount: 2 }),
      ] });
    });
    const adapter = new YouTubeSourceAdapter({ apiKey: "youtube-test-key", baseUrl: "https://youtube.test/youtube/v3", fetchImpl });
    const page = await adapter.discover({ query: "Jira alternative", limit: 10, expandThreads: false, requestMetadata: { maxVideos: 2, maxCommentsPerVideo: 5, includeReplies: true } });
    expect(page.items.map((item) => item.externalId)).toEqual(["youtube:comment:comment-1", "youtube:comment:comment-generic", "youtube:comment:comment-2"]);
    expect(page.providerMetrics).toMatchObject({ requestCount: 3, searchRequests: 1, commentThreadRequests: 2, videosDiscovered: 2, quotaUnits: 102 });
    const candidate = adapter.normalize(page.items[0]!);
    expect(candidate.externalId).toBe("youtube:comment:comment-1");
    expect(candidate.externalConversationId).toBe("youtube:video:video-1");
    expect(candidate.canonicalUrl).toContain("watch?v=video-1");
    expect(candidate.metadata).toMatchObject({ sourceCategory: "conversation", videoId: "video-1", channelId: "channel-1", likeCount: 4, query: "Jira alternative" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("surfaces YouTube quota errors and tolerates empty comments", async () => {
    const quotaAdapter = new YouTubeSourceAdapter({ apiKey: "youtube-test-key", baseUrl: "https://youtube.test/youtube/v3", maxAttempts: 1, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ error: "quotaExceeded" }, 403)) });
    await expect(quotaAdapter.discover({ query: "alternative", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const emptyFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/search") ? response({ items: [{ id: { videoId: "empty-video" }, snippet: { title: "Empty" } }] }) : response({ items: [] }));
    const emptyAdapter = new YouTubeSourceAdapter({ apiKey: "youtube-test-key", baseUrl: "https://youtube.test/youtube/v3", fetchImpl: emptyFetch });
    const page = await emptyAdapter.discover({ query: "empty", limit: 2, expandThreads: false, requestMetadata: { maxVideos: 1, maxCommentsPerVideo: 2 } });
    expect(page.items).toHaveLength(0);
    expect(page.providerMetrics).toMatchObject({ videosDiscovered: 1, commentsReturned: 0 });
  });

  it("skips GitLab when the token is missing", async () => {
    const adapter = new GitLabSourceAdapter({ token: "" });
    await expect(adapter.discover({ query: "migration", limit: 2, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false, errorCode: "MISSING_CREDENTIALS" });
  });

  it("discovers public GitLab projects/issues/discussions and normalizes stable IDs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v4/projects" && url.searchParams.has("search")) return response([{ id: 42, name: "workflow-tool", path: "workflow-tool", path_with_namespace: "public/workflow-tool", web_url: "https://gitlab.test/public/workflow-tool", description: "Public project", visibility: "public" }]);
      if (url.pathname.endsWith("/issues")) return response([{ id: 4201, iid: 7, project_id: 42, title: "Add SSO integration", description: "We need SSO for enterprise workflows.", web_url: "https://gitlab.test/public/workflow-tool/-/issues/7", state: "opened", labels: ["feature"], author: { id: 8, username: "dev", name: "Developer", web_url: "https://gitlab.test/dev" }, created_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-21T10:00:00Z" }]);
      return response([{ id: "discussion-1", notes: [
        { id: 701, body: "Migration from the old tool is painful.", author: { id: 9, username: "ops", name: "Ops" }, created_at: "2026-09-21T11:00:00Z", updated_at: "2026-09-21T11:00:00Z", system: false },
        { id: 701, body: "duplicate note", author: { id: 9, username: "ops" }, system: false },
        { id: 702, body: "System update", system: true },
      ] }]);
    });
    const adapter = new GitLabSourceAdapter({ token: "gitlab-test-token", baseUrl: "https://gitlab.test/api/v4", fetchImpl });
    const page = await adapter.discover({ query: "SSO migration", limit: 5, expandThreads: false, requestMetadata: { maxProjects: 2, maxIssuesPerProject: 2, maxNotesPerIssue: 4, includeDiscussions: true } });
    expect(page.items.map((item) => item.externalId)).toEqual(["gitlab:issue:42:7", "gitlab:comment:42:701"]);
    expect(page.providerMetrics).toMatchObject({ requestCount: 3, projectSearchRequests: 1, issueSearchRequests: 1, discussionRequests: 1, commentsReturned: 1 });
    const issue = adapter.normalize(page.items[0]!);
    const comment = adapter.normalize(page.items[1]!);
    expect(issue.metadata).toMatchObject({ sourceCategory: "developer_discussion", projectId: 42, issueIid: 7, labels: ["feature"] });
    expect(comment).toMatchObject({ externalId: "gitlab:comment:42:701", externalConversationId: "gitlab:issue:42:7" });
    expect(comment.metadata).toMatchObject({ noteId: 701, discussionId: "discussion-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps GitLab rate limits and empty public results without crawling repositories", async () => {
    const rateLimited = new GitLabSourceAdapter({ token: "gitlab-test-token", baseUrl: "https://gitlab.test/api/v4", maxAttempts: 1, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ error: "rate limit" }, 429)) });
    await expect(rateLimited.discover({ query: "tool", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(response([]));
    const emptyAdapter = new GitLabSourceAdapter({ token: "gitlab-test-token", baseUrl: "https://gitlab.test/api/v4", fetchImpl: emptyFetch });
    const page = await emptyAdapter.discover({ query: "not found", limit: 2, expandThreads: false, requestMetadata: {} });
    expect(page.items).toHaveLength(0);
    expect(emptyFetch).toHaveBeenCalledTimes(1);
    expect(emptyFetch.mock.calls[0]?.[0].toString()).not.toContain("repository");
  });
});
