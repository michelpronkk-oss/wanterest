import { z } from "zod";
import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type RateLimitMetadata,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import type { JsonObject } from "../../../db/database.helpers";
import {
  decodeGitHubDiscussionsCursor,
  decodeGitHubIssuesCursor,
  encodeGitHubDiscussionsCursor,
  encodeGitHubIssuesCursor,
  GitHubClient,
  type GitHubClientOptions,
} from "./github.client";
import { getGitHubRuntimeConfig } from "./github.auth";
import {
  githubDiscussionCommentNodeSchema,
  githubDiscussionNodeSchema,
  githubIssueSchema,
  githubRequestMetadataSchema,
  type GitHubRequestMetadata,
} from "./github.schemas";
import { normalizeGitHubItem } from "./github.normalizer";

type GitHubAdapterOptions = GitHubClientOptions & { clock?: () => Date };

function repositoryParts(repository: string | undefined): { owner: string; name: string } | undefined {
  if (!repository) return undefined;
  const [owner, name] = repository.split("/");
  return owner && name ? { owner, name } : undefined;
}

function repositoryFromIssue(issue: z.infer<typeof githubIssueSchema>, metadata: GitHubRequestMetadata): { owner?: string; name?: string; id?: number } {
  const fullName = issue.repository?.full_name ?? metadata.repository;
  const parsed = repositoryParts(fullName);
  if (parsed) return { ...parsed, id: issue.repository?.id };
  const urlMatch = issue.repository_url?.match(/\/repos\/([^/]+)\/([^/]+)$/);
  return urlMatch ? { owner: urlMatch[1], name: urlMatch[2], id: issue.repository?.id } : { id: issue.repository?.id };
}

function issueQuery(request: SourceDiscoveryRequest, metadata: GitHubRequestMetadata): string {
  if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "GitHub issue discovery requires a caller-supplied query.");
  const qualifiers = ["is:issue"];
  if (metadata.repository) qualifiers.push(`repo:${metadata.repository}`);
  else if (metadata.owner) qualifiers.push(`user:${metadata.owner}`);
  else if (metadata.org) qualifiers.push(`org:${metadata.org}`);
  return `${request.query} ${qualifiers.join(" ")}`.trim();
}

function discussionQuery(request: SourceDiscoveryRequest, metadata: GitHubRequestMetadata): string {
  if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "GitHub discussion discovery requires a caller-supplied query.");
  const qualifiers = ["is:discussion"];
  if (metadata.repository) qualifiers.push(`repo:${metadata.repository}`);
  else if (metadata.owner) qualifiers.push(`user:${metadata.owner}`);
  else if (metadata.org) qualifiers.push(`org:${metadata.org}`);
  return `${request.query} ${qualifiers.join(" ")}`.trim();
}

function localDiscussionMatch(discussion: z.infer<typeof githubDiscussionNodeSchema>, request: SourceDiscoveryRequest, metadata: GitHubRequestMetadata): boolean {
  if (metadata.discussionCategory && discussion.category?.name.toLowerCase() !== metadata.discussionCategory.toLowerCase()) return false;
  if (!request.query) return true;
  const haystack = `${discussion.title}\n${discussion.body ?? ""}`.toLowerCase();
  return request.query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "provider error";
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly key = "github";
  readonly capabilities = {
    supportsSearch: true,
    supportsIncrementalCursor: true,
    supportsThreadExpansion: true,
  } as const;

  private readonly client: GitHubClient;
  private readonly clock: () => Date;
  private readonly authenticated: boolean;

  constructor(options: GitHubAdapterOptions = {}) {
    const runtime = getGitHubRuntimeConfig();
    this.clock = options.clock ?? (() => new Date());
    const merged = { ...runtime, ...options };
    this.authenticated = Boolean(merged.token);
    this.client = new GitHubClient({ ...merged, clock: this.clock });
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const metadata = githubRequestMetadataSchema.parse(request.requestMetadata);
    if (metadata.repository && (metadata.owner || metadata.org)) {
      throw new SourceAdapterError("INVALID_REQUEST_METADATA", "GitHub repository cannot be combined with owner or org metadata.");
    }
    if (metadata.owner && metadata.org) throw new SourceAdapterError("INVALID_REQUEST_METADATA", "GitHub owner and org metadata cannot be combined.");
    if (request.cursor && metadata.contentType === "all") throw new SourceAdapterError("PAGINATION_UNAVAILABLE", "GitHub combined issue/discussion discovery does not expose a shared cursor.");

    const messages: string[] = [];
    let rejected = 0;
    let rateLimit: RateLimitMetadata | undefined;
    const items: RawSourceItemEnvelope[] = [];
    if (metadata.contentType === "issues" || metadata.contentType === "all") {
      const page = request.cursor ? decodeGitHubIssuesCursor(request.cursor) : 1;
      const search = await this.client.searchIssues({ query: issueQuery(request, metadata), limit: request.limit, page });
      rateLimit = search.rateLimit;
      const parsedSearch = search.response as { items: unknown[] };
      for (const [index, value] of parsedSearch.items.entries()) {
        const issue = githubIssueSchema.safeParse(value);
        if (!issue.success || issue.data.pull_request || issue.data.repository?.private === true) {
          rejected += 1;
          messages.push(issue.success
            ? issue.data.pull_request
              ? `issue ${index} rejected: expected a GitHub issue rather than a pull request`
              : `issue ${index} rejected: private repositories are not supported`
            : `issue ${index} rejected: malformed GitHub issue (${issue.error.issues[0]?.path.join(".") || "unknown field"})`);
          continue;
        }
        const repo = repositoryFromIssue(issue.data, metadata);
        const externalId = `github:issue:${repo.id ?? (repo.owner && repo.name ? `${repo.owner}/${repo.name}` : "unknown")}:${issue.data.number}`;
        items.push(this.envelope(issue.data, externalId, request, metadata, {
          itemType: "issue",
          rootExternalId: externalId,
          repository: repo.owner && repo.name ? `${repo.owner}/${repo.name}` : null,
          repositoryId: repo.id ?? null,
          page,
        }));
        if ((request.expandThreads || metadata.includeComments) && metadata.maxComments > 0 && repo.owner && repo.name) {
          let commentsForIssue = 0;
          for (let commentPage = 1; commentPage <= metadata.maxCommentPages && commentsForIssue < metadata.maxComments; commentPage += 1) {
            try {
              const comments = await this.client.getIssueComments(repo.owner, repo.name, issue.data.number, commentPage, metadata.maxComments);
              rateLimit = comments.rateLimit;
              rejected += comments.rejected;
              if (comments.rejected > 0) messages.push(`comments for ${externalId} contained ${comments.rejected} malformed item(s)`);
              for (const comment of comments.comments) {
                if (commentsForIssue >= metadata.maxComments) break;
                const parsedComment = comment;
                const commentId = parsedComment && typeof parsedComment === "object" && "id" in parsedComment && typeof parsedComment.id === "number" ? parsedComment.id : undefined;
                if (!commentId) { rejected += 1; messages.push(`comments for ${externalId} contained a malformed item`); continue; }
                items.push(this.envelope(comment, `github:issue_comment:${commentId}`, request, metadata, {
                  itemType: "issue_comment",
                  rootExternalId: externalId,
                  repository: `${repo.owner}/${repo.name}`,
                  repositoryId: repo.id ?? null,
                  parentIssueNumber: issue.data.number,
                  page: commentPage,
                }));
                commentsForIssue += 1;
              }
              if (!comments.hasNextPage) break;
            } catch (error) {
              messages.push(`comments for ${externalId} unavailable: ${errorMessage(error)}`);
              break;
            }
          }
        } else if ((request.expandThreads || metadata.includeComments) && metadata.maxComments > 0) {
          messages.push(`comments for ${externalId} unavailable: repository identity was not returned by GitHub`);
        }
      }
      const nextCursor = metadata.contentType === "issues" && search.nextPage ? encodeGitHubIssuesCursor(search.nextPage) : undefined;
      if (metadata.contentType === "issues") {
        return { items, nextCursor, rateLimit, diagnostics: { accepted: items.length, rejected, messages } };
      }
      if (search.nextPage) messages.push("combined GitHub discovery is bounded to the first issue page; use contentType=issues for cursors");
    }

    if (metadata.contentType === "discussions" || metadata.contentType === "all") {
      const after = request.cursor ? decodeGitHubDiscussionsCursor(request.cursor) : undefined;
      try {
          const discussions = await this.client.listDiscussions(discussionQuery(request, metadata), request.limit, after, metadata.includeComments || request.expandThreads ? metadata.maxComments : 0);
          rateLimit = discussions.rateLimit;
          const parsed = discussions.response as { search: { nodes: unknown[] } };
          for (const [index, value] of parsed.search.nodes.entries()) {
            const discussion = githubDiscussionNodeSchema.safeParse(value);
            if (!discussion.success || discussion.data.repository?.isPrivate === true || !localDiscussionMatch(discussion.data, request, metadata)) {
              rejected += 1;
              messages.push(`discussion ${index} rejected: ${discussion.success && discussion.data.repository?.isPrivate === true ? "private repositories are not supported" : "malformed or outside query scope"}`);
              continue;
            }
            const externalId = `github:discussion:${discussion.data.id}`;
            items.push(this.envelope(discussion.data, externalId, request, metadata, {
              itemType: "discussion",
              rootExternalId: externalId,
              repository: discussion.data.repository?.nameWithOwner ?? metadata.repository ?? null,
              repositoryId: discussion.data.repository?.id ?? null,
            }));
            if ((request.expandThreads || metadata.includeComments) && discussion.data.comments) {
              for (const commentValue of discussion.data.comments.nodes) {
                const comment = githubDiscussionCommentNodeSchema.safeParse(commentValue);
                if (!comment.success) { rejected += 1; messages.push(`comments for ${externalId} contained a malformed item`); continue; }
                items.push(this.envelope(comment.data, `github:discussion_comment:${comment.data.id}`, request, metadata, {
                  itemType: "discussion_comment",
                  rootExternalId: externalId,
                  repository: discussion.data.repository?.nameWithOwner ?? metadata.repository ?? null,
                  repositoryId: discussion.data.repository?.id ?? null,
                }));
              }
              if (discussion.data.comments.pageInfo.hasNextPage) messages.push(`comments for ${externalId} bounded at ${metadata.maxComments}`);
            }
          }
          const nextCursor = metadata.contentType === "discussions" && discussions.hasNextPage && discussions.endCursor ? encodeGitHubDiscussionsCursor(discussions.endCursor) : undefined;
          return { items, nextCursor, rateLimit, diagnostics: { accepted: items.length, rejected, messages } };
        } catch (error) {
          if (metadata.contentType === "discussions") throw error;
          messages.push(`GitHub discussions unavailable: ${errorMessage(error)}`);
      }
    }
    return { items, rateLimit, diagnostics: { accepted: items.length, rejected, messages } };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    return normalizeGitHubItem(rawSourceItemEnvelopeSchema.parse(raw));
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try {
      const rateLimit = await this.client.healthCheck();
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit, degradationState: "healthy" };
    } catch (error) {
      const blocked = error instanceof SourceAdapterError && ["RATE_LIMITED", "FORBIDDEN", "AUTH_FAILED"].includes(error.code);
      return {
        sourceKey: this.key,
        ok: false,
        latencyMs: Date.now() - started,
        degradationState: blocked ? "blocked" : "degraded",
        errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED",
        errorSummary: errorMessage(error),
      };
    }
  }

  private envelope(payload: unknown, externalId: string, request: SourceDiscoveryRequest, metadata: GitHubRequestMetadata, context: JsonObject): RawSourceItemEnvelope {
    return {
      sourceKey: this.key,
      externalId,
      fetchedAt: this.clock().toISOString(),
      payload,
      requestMetadata: {
        provider: "github",
        contentType: metadata.contentType,
        endpoint: metadata.contentType === "discussions" ? "/graphql" : "/search/issues",
        query: request.query ?? null,
        repository: metadata.repository ?? null,
        owner: metadata.owner ?? null,
        org: metadata.org ?? null,
        includeComments: metadata.includeComments || request.expandThreads,
        maxComments: metadata.maxComments,
        maxCommentPages: metadata.maxCommentPages,
        authenticated: this.authenticated,
      },
      cursorContext: context,
    };
  }

}

export const githubSourceAdapter = new GitHubSourceAdapter();
export { GitHubClient } from "./github.client";
export { normalizeGitHubItem } from "./github.normalizer";
