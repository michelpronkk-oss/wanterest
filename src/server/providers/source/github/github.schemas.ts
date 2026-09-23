import { z } from "zod";

const nullableString = z.string().nullable().optional();

export const githubUserSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  node_id: z.string().optional(),
  login: z.string().optional(),
  type: z.string().optional(),
  html_url: z.string().url().optional(),
  location: z.string().max(500).nullable().optional(),
}).nullable().optional();

export const githubRepositorySchema = z.object({
  id: z.number().int().nonnegative().optional(),
  node_id: z.string().optional(),
  name: z.string().optional(),
  full_name: z.string().optional(),
  html_url: z.string().url().optional(),
  url: z.string().url().optional(),
  owner: githubUserSchema,
  private: z.boolean().optional(),
}).passthrough().nullable().optional();

export const githubLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  description: nullableString,
}).passthrough();

export const githubMilestoneSchema = z.object({
  number: z.number().int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
}).passthrough().nullable().optional();

export const githubReactionsSchema = z.record(z.string(), z.union([z.number().int(), z.string()])).optional();

export const githubIssueSchema = z.object({
  id: z.number().int().nonnegative(),
  node_id: z.string().optional(),
  number: z.number().int().positive(),
  title: z.string(),
  body: nullableString,
  html_url: z.string().url(),
  url: z.string().url().optional(),
  user: githubUserSchema,
  repository: githubRepositorySchema,
  repository_url: z.string().url().optional(),
  state: z.enum(["open", "closed"]).optional(),
  locked: z.boolean().optional(),
  comments: z.number().int().nonnegative().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  closed_at: z.string().datetime({ offset: true }).nullable().optional(),
  labels: z.array(githubLabelSchema).optional(),
  milestone: githubMilestoneSchema,
  reactions: githubReactionsSchema,
  pull_request: z.object({ html_url: z.string().url().optional() }).passthrough().nullable().optional(),
  draft: z.boolean().optional(),
}).passthrough();

export const githubIssueSearchResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(z.unknown()),
}).passthrough();

export const githubIssueCommentSchema = z.object({
  id: z.number().int().nonnegative(),
  node_id: z.string().optional(),
  body: nullableString,
  html_url: z.string().url(),
  url: z.string().url().optional(),
  user: githubUserSchema,
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  author_association: z.string().optional(),
  reactions: githubReactionsSchema,
}).passthrough();

const githubGraphqlAuthorSchema = z.object({
  id: z.string().optional(),
  login: z.string().optional(),
  url: z.string().url().optional(),
  __typename: z.string().optional(),
  location: z.string().max(500).nullable().optional(),
}).nullable().optional();

export const githubDiscussionCommentNodeSchema = z.object({
  id: z.string(),
  body: z.string().nullable().optional(),
  url: z.string().url(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  author: githubGraphqlAuthorSchema,
}).passthrough();

const githubDiscussionCommentConnectionSchema = z.object({
  nodes: z.array(z.unknown()),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
}).passthrough();

export const githubDiscussionNodeSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable().optional(),
  url: z.string().url(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  author: githubGraphqlAuthorSchema,
  category: z.object({ name: z.string() }).nullable().optional(),
  repository: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    nameWithOwner: z.string().optional(),
    url: z.string().url().optional(),
    isPrivate: z.boolean().optional(),
    owner: z.object({ login: z.string().optional() }).optional(),
  }).passthrough().optional(),
  comments: githubDiscussionCommentConnectionSchema.optional(),
}).passthrough();

export const githubGraphqlResponseSchema = z.object({
  data: z.unknown().nullable().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough();

export const githubDiscussionListSchema = z.object({
  repository: z.object({
    discussions: z.object({
      nodes: z.array(z.unknown()),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export const githubDiscussionSearchSchema = z.object({
  search: z.object({
    nodes: z.array(z.unknown()),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }).passthrough(),
}).passthrough();

export const githubRateLimitResponseSchema = z.object({
  rate: z.object({
    limit: z.number().int().nonnegative().optional(),
    remaining: z.number().int().nonnegative().optional(),
    reset: z.number().int().nonnegative().optional(),
    resource: z.string().optional(),
  }).optional(),
}).passthrough();

export const githubRequestMetadataSchema = z.object({
  contentType: z.enum(["issues", "discussions", "all"]).default("issues"),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional(),
  org: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional(),
  includeComments: z.boolean().default(false),
  maxComments: z.number().int().min(0).max(50).default(20),
  maxCommentPages: z.number().int().min(1).max(2).default(2),
  discussionCategory: z.string().trim().max(100).optional(),
}).passthrough();

export type GitHubRequestMetadata = z.infer<typeof githubRequestMetadataSchema>;
