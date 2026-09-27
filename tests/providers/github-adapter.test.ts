import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "../../src/server/db/database.helpers";

import {
  githubDiscussionComment,
  githubDiscussion,
  githubDiscussionsResponse,
  githubIssue,
  githubIssueComment,
  githubIssueSearchResponse,
} from "../../src/server/providers/source/github/fixtures";
import {
  GitHubSourceAdapter,
  normalizeGitHubItem,
} from "../../src/server/providers/source/github";
import { evaluateGitHubDepth } from "../../src/server/providers/source/github/github-depth";

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

  it("executes the bounded pain query with valid issue and discussion syntax", async () => {
    const providerQuery = '(\"looking for\" OR \"struggling with\" OR \"need\") (\"project management\" OR \"issue tracking\")';
    const painMetadata = {
      githubPainRetrievalV1: {
        semanticQuery: "project management software inefficient software development workflows",
        providerQuery,
        templateVersion: "github_pain_retrieval_v1_1",
        booleanOperatorCount: 3,
        demandAnchors: ["looking for", "struggling with", "need"],
        categoryAnchors: ["project management", "issue tracking"],
      },
    };
    const issueFetch = vi.fn<typeof fetch>().mockResolvedValue(response({ ...githubIssueSearchResponse, items: [] }));
    await new GitHubSourceAdapter({ fetchImpl: issueFetch }).discover({ query: providerQuery, limit: 1, expandThreads: false, requestMetadata: { ...painMetadata, contentType: "issues" } });
    const issueRequest = new URL(String(issueFetch.mock.calls[0]?.[0]));
    expect(issueRequest.searchParams.get("q")).toBe(`${providerQuery} is:issue`);
    expect(issueRequest.searchParams.get("q")).toContain("(");
    expect(issueRequest.searchParams.get("q")).toContain(" OR ");

    const discussionFetch = vi.fn<typeof fetch>().mockResolvedValue(response(githubDiscussionsResponse));
    await new GitHubSourceAdapter({ fetchImpl: discussionFetch, token: "test-token" }).discover({ query: providerQuery, limit: 1, expandThreads: false, requestMetadata: { ...painMetadata, contentType: "discussions" } });
    const discussionBody = JSON.parse(String(discussionFetch.mock.calls[0]?.[1]?.body));
    expect(discussionBody.variables.query).toBe(`${providerQuery} is:discussion`);
    expect(discussionBody.variables.query).toContain("(");
    expect(discussionBody.variables.query).toContain(" OR ");
  });

  it("preserves the bounded GitHub provider error for an over-operator query", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      message: "Validation Failed",
      errors: [{ message: "More than five AND / OR / NOT operators were used.", resource: "Search", field: "q", code: "invalid" }],
      status: "422",
    }, 422));
    await expect(new GitHubSourceAdapter({ fetchImpl }).discover({ query: "(one OR two OR three OR four OR five OR six) (a OR b)", limit: 1, expandThreads: false, requestMetadata: { contentType: "issues" } })).rejects.toMatchObject({
      code: "HTTP_422",
      providerDetails: { status: 422, message: "Validation Failed: More than five AND / OR / NOT operators were used." },
    });
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

  it("applies GitHub Depth V1 only to demand-like public threads and records bounded telemetry", async () => {
    const humanComment = { ...githubIssueComment, id: 7002, user: { ...githubIssueComment.user, id: 10, login: "bob", type: "User" } };
    const automatedIssue = { ...githubIssue, id: 103, number: 43, title: "Automated dependency update", user: { ...githubIssue.user, type: "Bot" }, labels: [{ name: "dependencies" }] };
    const technicalIssue = { ...githubIssue, id: 104, number: 44, title: "Refactor export internals", body: "Implementation detail only.", comments: 1 };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...githubIssueSearchResponse, items: [githubIssue, automatedIssue, technicalIssue] }))
      .mockResolvedValueOnce(response([humanComment]));
    const adapter = new GitHubSourceAdapter({ fetchImpl });

    const page = await adapter.discover({
      query: "export",
      limit: 3,
      expandThreads: false,
      requestMetadata: { contentType: "issues", queryPlanVersion: "query_planning_v8", maxComments: 12 },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(page.items.map((item) => item.externalId)).toEqual(["github:issue:9001:42", "github:issue_comment:7002", "github:issue:9001:43", "github:issue:9001:44"]);
    expect(page.providerMetrics).toMatchObject({ githubDepthV1: { policyVersion: "github_depth_v1", rootsSeen: 3, eligibleRoots: 1, expandedRoots: 1, commentRequests: 1, commentsReturned: 1, commentsPersisted: 1, ineligibleRoots: 2 } });
  });

  it("deduplicates depth comments, caps root expansions, and preserves refresh-window identity", async () => {
    const humanComment = { ...githubIssueComment, id: 7010, user: { ...githubIssueComment.user, id: 11, login: "carol", type: "User" } };
    const roots = [42, 43, 44, 45].map((number, index) => ({ ...githubIssue, id: 200 + index, number, title: `Need export improvement ${number}`, updated_at: "2026-09-20T09:00:00.000Z", comments: 1 }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...githubIssueSearchResponse, items: roots }))
      .mockImplementation(async () => response([humanComment, humanComment]));
    const adapter = new GitHubSourceAdapter({ fetchImpl });

    const page = await adapter.discover({
      query: "export",
      limit: 4,
      expandThreads: false,
      windowStart: "2026-09-20T00:00:00.000Z",
      windowEnd: "2026-09-21T00:00:00.000Z",
      requestMetadata: { contentType: "issues", depthPolicyVersion: "github_depth_v1", maxComments: 12 },
    });
    const searchRequest = new URL(String(fetchImpl.mock.calls[0]?.[0]));

    expect(searchRequest.searchParams.get("q")).toContain("updated:>=2026-09-20");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(page.items.filter((item) => item.externalId === "github:issue_comment:7010")).toHaveLength(1);
    expect(page.providerMetrics).toMatchObject({ githubDepthV1: { rootsSeen: 4, eligibleRoots: 3, expandedRoots: 3, expansionCapSkips: 1, duplicateCommentsSkipped: 5 } });
  });

  it("keeps the depth gate deterministic for adversarial GitHub thread shapes", () => {
    expect(evaluateGitHubDepth({ title: "Dependency release", body: "Automated update", authorType: "Bot", labels: ["dependencies"], commentsAvailable: true })).toMatchObject({ eligible: false, reason: "automation" });
    expect(evaluateGitHubDepth({ title: "Refactor internals", body: "No user request here", authorType: "User", commentsAvailable: true })).toMatchObject({ eligible: false, reason: "not_demand_like" });
    expect(evaluateGitHubDepth({ title: "We need export filters", body: "Please preserve the selected filters.", authorType: "User", commentsAvailable: true })).toMatchObject({ eligible: true, reason: "eligible" });
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

  it("applies the same depth gate to Discussions while keeping the GraphQL request bounded", async () => {
    const discussion = {
      ...githubDiscussion,
      body: "We need an export workflow that preserves filters.",
      comments: { nodes: [{ ...githubDiscussionComment, author: { ...githubDiscussionComment.author, __typename: "User" } }], pageInfo: { hasNextPage: false, endCursor: null } },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { search: { nodes: [discussion], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    const adapter = new GitHubSourceAdapter({ fetchImpl, token: "test-token" });

    const page = await adapter.discover({ query: "export", limit: 1, expandThreads: false, requestMetadata: { contentType: "discussions", depthPolicyVersion: "github_depth_v1", maxComments: 20 } });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    expect(requestBody.variables.commentFirst).toBe(12);
    expect(page.items.map((item) => item.externalId)).toEqual(["github:discussion:D_kwDOdiscussion5", "github:discussion_comment:DC_kwDOfirstcomment"]);
    expect(page.providerMetrics).toMatchObject({ githubDepthV1: { rootsSeen: 1, eligibleRoots: 1, expandedRoots: 1, commentRequests: 1, commentsPersisted: 1 } });
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
