import { z } from "zod";

const nullableString = z.string().nullable().optional();

export const redditSubmissionDataSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300).optional(),
  title: nullableString,
  selftext: nullableString,
  author: nullableString,
  author_fullname: nullableString,
  subreddit: nullableString,
  subreddit_id: nullableString,
  subreddit_name_prefixed: nullableString,
  subreddit_type: nullableString,
  permalink: nullableString,
  url: nullableString,
  created_utc: z.number().finite(),
  is_self: z.boolean().optional(),
  score: z.number().finite().optional(),
  num_comments: z.number().int().nonnegative().optional(),
  upvote_ratio: z.number().finite().optional(),
  domain: nullableString,
  link_flair_text: nullableString,
  over_18: z.boolean().optional(),
  locked: z.boolean().optional(),
  stickied: z.boolean().optional(),
  removed_by_category: nullableString,
  removed: z.boolean().optional(),
  crosspost_parent: nullableString,
  crosspost_parent_list: z.array(z.unknown()).optional(),
}).passthrough();

export const redditCommentDataSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300).optional(),
  body: nullableString,
  author: nullableString,
  author_fullname: nullableString,
  parent_id: nullableString,
  link_id: nullableString,
  subreddit: nullableString,
  subreddit_id: nullableString,
  permalink: nullableString,
  created_utc: z.number().finite().optional(),
  score: z.number().finite().optional(),
  depth: z.number().int().nonnegative().optional(),
  replies: z.unknown().optional(),
  removed_by_category: nullableString,
  collapsed: z.boolean().optional(),
}).passthrough();

export const redditListingChildSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  data: z.unknown(),
}).passthrough();

export const redditListingSchema = z.object({
  kind: z.literal("Listing").optional(),
  data: z.object({
    after: z.string().trim().min(1).nullable().optional(),
    before: z.string().trim().min(1).nullable().optional(),
    children: z.array(z.unknown()),
    dist: z.number().int().nonnegative().optional(),
  }).passthrough(),
}).passthrough();

export const redditCommentsResponseSchema = z.array(z.unknown());

export const redditTokenResponseSchema = z.object({
  access_token: z.string().trim().min(1),
  token_type: z.string().trim().min(1),
  expires_in: z.number().finite().nonnegative(),
  scope: z.string().optional(),
}).passthrough();

const subredditNameSchema = z.string().trim().regex(/^[A-Za-z0-9_]{1,70}$/);

export const redditRequestMetadataSchema = z.object({
  subreddit: subredditNameSchema.optional(),
  community: subredditNameSchema.optional(),
  sort: z.enum(["relevance", "hot", "top", "new", "comments"]).default("relevance"),
  time: z.enum(["hour", "day", "week", "month", "year", "all"]).optional(),
  commentSort: z.enum(["confidence", "top", "new", "controversial", "old", "qa"]).default("top"),
  maxComments: z.number().int().min(0).max(50).default(20),
  maxCommentDepth: z.number().int().min(0).max(3).default(2),
  excludeNsfw: z.boolean().default(true),
}).passthrough();

export type RedditSubmissionData = z.infer<typeof redditSubmissionDataSchema>;
export type RedditCommentData = z.infer<typeof redditCommentDataSchema>;
export type RedditListing = z.infer<typeof redditListingSchema>;
export type RedditRequestMetadata = z.infer<typeof redditRequestMetadataSchema>;
