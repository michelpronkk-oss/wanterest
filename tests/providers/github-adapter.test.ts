import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "../../src/server/db/database.helpers";

import {
  githubDiscussionComment,
  githubDiscussionsResponse,
  githubIssue,
  githubIssueComment,
  githubIssueSearchResponse,
} from "../../src/server/providers/source/github/fixtures";
import {
  GitHubSourceAdapter,
  normalizeGitHubItem,
} from "../../src/server/providers/source/github";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function envelope(payload: unknown, externalId: string, cursorContext: JsonObject = {}) {
  return {
    sourceKey: "github",
    externalId,
    fetchedAt: "2026-09-20T10:00:00.000Z",
    payload,
    requestMetadata: {},
    cursorContext,
  };
}

describe("GitHub source adapter", () => {
  it("searches official REST issues, filters pull requests, and keeps caller query/limits", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(githubIssueSearchResponse, 200, {
      link: '<https://api.github.com/search/issues?q=export&page=2>; rel="next"',
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-reset": "1790000000",
      "x-ratelimit-resource": "search",
    }));
    const adapter = new GitHubSourceAdapter({ fetchImpl, clock: () => new Date("2026-09-20T10:00:00.000Z") });

    const page = await adapter.discover({ query: "export filters", limit: 100, requestMetadata: { repository: "acme/product" }, expandThreads: false });
    const request = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(request.origin).toBe("https://api.github.com");
    expect(request.pathname).toBe("/search/issues");
    expect(request.searchParams.get("q")).toBe("export filters is:issue repo:acme/product");
    expect(request.searchParams.get("per_page")).toBe("100");
    expect(request.searchParams.get("page")).toBe("1");
    expect(init?.headers).toMatchObject({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Wanterest/1.0 (source-connector)" });
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.externalId).toBe("github:issue:9001:42");
    expect(page.nextCursor).toMatch(/^github:v1:issues:/);
    expect(page.rateLimit).toMatchObject({ provider: "github-rest", mode: "public", resource: "search", remaining: 4999, limit: 5000 });
  });

  it("attaches GITHUB_TOKEN to authenticated REST search and reports authenticated limits", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(githubIssueSearchResponse, 200, {
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-resource": "search",
    }));
    const adapter = new GitHubSourceAdapter({ fetchImpl, token: "test-token" });

    const page = await adapter.discover({ query: "export", limit: 1, expandThreads: false, requestMetadata: {} });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(page.rateLimit).toMatchObject({ provider: "github-rest", mode: "authenticated", resource: "search", remaining: 4999, limit: 5000 });
  });

  it("expands bounded issue comments and maps them to the issue root", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...githubIssueSearchResponse, items: [githubIssue] }))
      .mockResolvedValueOnce(response([githubIssueComment, { nope: true }]));
    const adapter = new GitHubSourceAdapter({ fetchImpl });
    const page = await adapter.discover({ query: "export", limit: 1, expandThreads: true, requestMetadata: { maxComments: 1, maxCommentPages: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(page.items.map((item) => item.externalId)).toEqual(["github:issue:9001:42", "github:issue_comment:7001"]);
    expect(page.items[1]?.cursorContext).toMatchObject({ itemType: "issue_comment", rootExternalId: "github:issue:9001:42" });
    expect(page.diagnostics.messages.join(" ")).toContain("malformed");
  });

  it("lists repository discussions through GraphQL with bounded comments and cursor mapping", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(githubDiscussionsResponse));
    const adapter = new GitHubSourceAdapter({ fetchImpl, token: "test-token" });
    const page = await adapter.discover({ query: "export", limit: 10, expandThreads: true, requestMetadata: { contentType: "discussions", repository: "acme/product", maxComments: 5 } });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe("/graphql");
    expect(requestBody.variables).toMatchObject({ query: "export is:discussion repo:acme/product", first: 10, commentFirst: 5, after: null });
    expect(requestBody.query).not.toMatch(/\blocation\b/);
    expect(requestBody.query).not.toContain("author { id");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(page.items.map((item) => item.externalId)).toEqual(["github:discussion:D_kwDOdiscussion5", "github:discussion_comment:DC_kwDOfirstcomment"]);
    expect(page.nextCursor).toMatch(/^github:v1:discussions:/);
    expect(page.rateLimit).toMatchObject({ provider: "github-graphql", mode: "authenticated" });
  });

  it("normalizes discussions when GraphQL authors have no location", () => {
    const discussion = normalizeGitHubItem(envelope(githubDiscussionsResponse.data.search.nodes[0], "github:discussion:D_kwDOdiscussion5", { itemType: "discussion", repository: "acme/product" }));
    const comment = normalizeGitHubItem(envelope(githubDiscussionComment, "github:discussion_comment:DC_kwDOfirstcomment", { itemType: "discussion_comment", rootExternalId: "github:discussion:D_kwDOdiscussion5" }));

    expect(discussion).toMatchObject({ externalId: "github:discussion:D_kwDOdiscussion5", status: "active" });
    expect(discussion.metadata).toMatchObject({ authorLocation: null });
    expect(comment).toMatchObject({ externalId: "github:discussion_comment:DC_kwDOfirstcomment", status: "active" });
    expect(comment.metadata).toMatchObject({ authorLocation: null });
  });

  it("normalizes stable identities, closed-state metadata, labels, and bot authors", () => {
    const issue = normalizeGitHubItem(envelope(githubIssue, "github:issue:9001:42", { itemType: "issue", repository: "acme/product", repositoryId: 9001 }));
    const comment = normalizeGitHubItem(envelope(githubIssueComment, "github:issue_comment:7001", { itemType: "issue_comment", rootExternalId: "github:issue:9001:42" }));
    expect(issue).toMatchObject({ externalId: "github:issue:9001:42", externalConversationId: "github:issue:9001:42", title: githubIssue.title, status: "active" });
    expect(issue.metadata).toMatchObject({ state: "closed", labels: ["bug"], repository: "acme/product", repositoryId: 9001 });
    expect(comment).toMatchObject({ externalId: "github:issue_comment:7001", externalConversationId: "github:issue:9001:42", authorDisplayName: "bot-helper" });
    expect(comment.metadata).toMatchObject({ itemType: "issue_comment" });
  });

  it("classifies rate limits, retries transient errors, and does not retry forbidden responses", async () => {
    const limited = vi.fn<typeof fetch>().mockResolvedValue(response({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" }));
    await expect(new GitHubSourceAdapter({ fetchImpl: limited, maxAttempts: 2, backoffMs: 0 }).discover({ query: "export", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(limited).toHaveBeenCalledTimes(2);

    const forbidden = vi.fn<typeof fetch>().mockResolvedValue(response({ message: "Requires authentication" }, 403, { "x-ratelimit-remaining": "20" }));
    await expect(new GitHubSourceAdapter({ fetchImpl: forbidden, maxAttempts: 2, backoffMs: 0 }).discover({ query: "export", limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it("reports public health without requiring credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ rate: { limit: 60, remaining: 59, reset: 1790000000, resource: "core" } }));
    await expect(new GitHubSourceAdapter({ fetchImpl }).healthCheck()).resolves.toMatchObject({ sourceKey: "github", ok: true, degradationState: "healthy", rateLimit: { mode: "public", provider: "github-rest" } });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/rate_limit");
  });

  it("keeps issue discovery usable when optional GraphQL discussions are unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...githubIssueSearchResponse, items: [githubIssue] }))
      .mockResolvedValueOnce(response({ message: "Requires authentication" }, 403, { "x-ratelimit-remaining": "20" }));
    const adapter = new GitHubSourceAdapter({ fetchImpl });
    const page = await adapter.discover({ query: "export", limit: 1, requestMetadata: { contentType: "all", repository: "acme/product" }, expandThreads: false });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.externalId).toBe("github:issue:9001:42");
    expect(page.diagnostics.messages.join(" ")).toContain("discussions unavailable");
  });

  it("reports a typed timeout after bounded retries", async () => {
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(new GitHubSourceAdapter({ fetchImpl: timeout, maxAttempts: 2, backoffMs: 0 }).discover({ query: "export", limit: 1, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(timeout).toHaveBeenCalledTimes(2);
  });
});
