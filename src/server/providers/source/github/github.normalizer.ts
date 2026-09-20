import {
  rawSourceItemEnvelopeSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceItemCandidate,
} from "../contracts";
import { githubDiscussionCommentNodeSchema, githubDiscussionNodeSchema, githubIssueCommentSchema, githubIssueSchema } from "./github.schemas";

function valueOrNull(value: string | number | boolean | null | undefined): string | number | boolean | null {
  return value ?? null;
}

function authorFields(user: { id?: number; node_id?: string; login?: string; type?: string; html_url?: string } | null | undefined) {
  return {
    authorExternalId: user?.id !== undefined ? `github:user:${user.id}` : user?.node_id ? `github:user-node:${user.node_id}` : undefined,
    authorDisplayName: user?.login,
    authorProfileUrl: user?.html_url,
    authorType: user?.type ?? null,
  };
}

function graphqlAuthorFields(author: { id?: string; login?: string; url?: string; __typename?: string } | null | undefined) {
  return {
    authorExternalId: author?.id ? `github:user-node:${author.id}` : undefined,
    authorDisplayName: author?.login,
    authorProfileUrl: author?.url,
    authorType: author?.__typename ?? null,
  };
}

function repositoryFields(repository: { id?: number; name?: string; full_name?: string; html_url?: string; owner?: { login?: string } | null } | null | undefined, context: RawSourceItemEnvelope["cursorContext"]) {
  const fullName = repository?.full_name ?? (typeof context.repository === "string" ? context.repository : null);
  const owner = repository?.owner?.login ?? (fullName?.includes("/") ? fullName.split("/")[0] : null);
  const name = repository?.name ?? (fullName?.includes("/") ? fullName.split("/")[1] : null);
  return {
    repositoryId: repository?.id ?? (typeof context.repositoryId === "number" ? context.repositoryId : null),
    repository: fullName,
    owner,
    repositoryName: name,
  };
}

function issueExternalId(issue: { repository?: { id?: number; full_name?: string } | null; number: number }, context: RawSourceItemEnvelope["cursorContext"]): string {
  const repositoryId = issue.repository?.id ?? (typeof context.repositoryId === "number" ? context.repositoryId : undefined) ?? issue.repository?.full_name ?? context.repository;
  if (!repositoryId) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub issue is missing repository identity.");
  return `github:issue:${repositoryId}:${issue.number}`;
}

export function normalizeGitHubItem(rawInput: RawSourceItemEnvelope): SourceItemCandidate {
  const raw = rawSourceItemEnvelopeSchema.parse(rawInput);
  const itemType = raw.cursorContext.itemType;
  if (itemType === "issue") return normalizeIssue(raw);
  if (itemType === "issue_comment") return normalizeIssueComment(raw);
  if (itemType === "discussion") return normalizeDiscussion(raw);
  if (itemType === "discussion_comment") return normalizeDiscussionComment(raw);
  throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub item type is missing or unsupported.");
}

function normalizeIssue(raw: RawSourceItemEnvelope): SourceItemCandidate {
  const parsed = githubIssueSchema.safeParse(raw.payload);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub issue failed validation.");
  const issue = parsed.data;
  if (issue.pull_request) throw new SourceAdapterError("UNSUPPORTED_ITEM", "GitHub pull requests are not source issues.");
  const externalId = issueExternalId(issue, raw.cursorContext);
  const repo = repositoryFields(issue.repository, raw.cursorContext);
  return sourceItemCandidateSchema.parse({
    sourceKey: "github",
    externalId,
    externalConversationId: externalId,
    canonicalUrl: issue.html_url,
    ...authorFields(issue.user),
    title: issue.title,
    body: issue.body ?? "",
    publishedAt: issue.created_at,
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "issue",
      issueNumber: issue.number,
      nodeId: valueOrNull(issue.node_id),
      ...repo,
      state: valueOrNull(issue.state),
      locked: valueOrNull(issue.locked),
      comments: valueOrNull(issue.comments),
      createdAt: valueOrNull(issue.created_at),
      updatedAt: valueOrNull(issue.updated_at),
      closedAt: valueOrNull(issue.closed_at),
      labels: issue.labels?.map((label) => label.name) ?? [],
      milestone: issue.milestone ? { number: issue.milestone.number ?? null, title: issue.milestone.title ?? null, state: issue.milestone.state ?? null } : null,
      reactions: issue.reactions ?? null,
      authorType: issue.user?.type ?? null,
      pullRequest: false,
    },
    status: "active",
  });
}

function rootIssueId(raw: RawSourceItemEnvelope): string {
  if (typeof raw.cursorContext.rootExternalId !== "string" || !raw.cursorContext.rootExternalId.startsWith("github:issue:")) {
    throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub issue comment is missing its root issue identity.");
  }
  return raw.cursorContext.rootExternalId;
}

function normalizeIssueComment(raw: RawSourceItemEnvelope): SourceItemCandidate {
  const parsed = githubIssueCommentSchema.safeParse(raw.payload);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub issue comment failed validation.");
  const comment = parsed.data;
  return sourceItemCandidateSchema.parse({
    sourceKey: "github",
    externalId: `github:issue_comment:${comment.id}`,
    externalConversationId: rootIssueId(raw),
    canonicalUrl: comment.html_url,
    ...authorFields(comment.user),
    body: comment.body ?? "",
    publishedAt: comment.created_at,
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "issue_comment",
      commentId: comment.id,
      nodeId: valueOrNull(comment.node_id),
      rootExternalId: rootIssueId(raw),
      updatedAt: valueOrNull(comment.updated_at),
      authorAssociation: valueOrNull(comment.author_association),
      reactions: comment.reactions ?? null,
      authorType: comment.user?.type ?? null,
    },
    status: "active",
  });
}

function discussionRepositoryFields(repository: { id?: string; name?: string; nameWithOwner?: string; owner?: { login?: string } } | undefined) {
  const fullName = repository?.nameWithOwner ?? null;
  return {
    repositoryId: repository?.id ?? null,
    repository: fullName,
    owner: repository?.owner?.login ?? (fullName?.includes("/") ? fullName.split("/")[0] : null),
    repositoryName: repository?.name ?? (fullName?.includes("/") ? fullName.split("/")[1] : null),
  };
}

function normalizeDiscussion(raw: RawSourceItemEnvelope): SourceItemCandidate {
  const parsed = githubDiscussionNodeSchema.safeParse(raw.payload);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub discussion failed validation.");
  const discussion = parsed.data;
  const externalId = `github:discussion:${discussion.id}`;
  const repo = discussionRepositoryFields(discussion.repository);
  return sourceItemCandidateSchema.parse({
    sourceKey: "github",
    externalId,
    externalConversationId: externalId,
    canonicalUrl: discussion.url,
    ...graphqlAuthorFields(discussion.author),
    title: discussion.title,
    body: discussion.body ?? "",
    publishedAt: discussion.createdAt,
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "discussion",
      discussionNumber: discussion.number,
      nodeId: discussion.id,
      ...repo,
      category: discussion.category?.name ?? null,
      createdAt: valueOrNull(discussion.createdAt),
      updatedAt: valueOrNull(discussion.updatedAt),
      comments: discussion.comments?.nodes.length ?? 0,
      authorType: discussion.author?.__typename ?? null,
    },
    status: "active",
  });
}

function rootDiscussionId(raw: RawSourceItemEnvelope): string {
  if (typeof raw.cursorContext.rootExternalId !== "string" || !raw.cursorContext.rootExternalId.startsWith("github:discussion:")) {
    throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub discussion comment is missing its root discussion identity.");
  }
  return raw.cursorContext.rootExternalId;
}

function normalizeDiscussionComment(raw: RawSourceItemEnvelope): SourceItemCandidate {
  const parsed = githubDiscussionCommentNodeSchema.safeParse(raw.payload);
  if (!parsed.success) {
    throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitHub discussion comment failed validation.");
  }
  const comment = parsed.data;
  return sourceItemCandidateSchema.parse({
    sourceKey: "github",
    externalId: `github:discussion_comment:${comment.id}`,
    externalConversationId: rootDiscussionId(raw),
    canonicalUrl: comment.url,
    ...graphqlAuthorFields(comment.author),
    body: comment.body ?? "",
    publishedAt: comment.createdAt,
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "discussion_comment",
      commentId: comment.id,
      rootExternalId: rootDiscussionId(raw),
      updatedAt: valueOrNull(comment.updatedAt),
      authorType: comment.author?.__typename ?? null,
    },
    status: "active",
  });
}

export function githubIssueExternalId(repositoryId: number | string, issueNumber: number): string {
  return `github:issue:${repositoryId}:${issueNumber}`;
}
