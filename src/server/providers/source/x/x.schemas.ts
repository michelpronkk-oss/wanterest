import { z } from "zod";

export const xUserSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().max(500),
  username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  protected: z.boolean().optional(),
  location: z.string().max(500).nullable().optional(),
}).passthrough();

export const xReferencedTweetSchema = z.object({
  type: z.enum(["retweeted", "replied_to", "quoted"]),
  id: z.string().regex(/^\d+$/),
}).passthrough();

export const xTweetSchema = z.object({
  id: z.string().regex(/^\d+$/),
  text: z.string().max(10_000),
  author_id: z.string().regex(/^\d+$/).optional(),
  conversation_id: z.string().regex(/^\d+$/).optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  lang: z.string().trim().max(32).optional(),
  public_metrics: z.record(z.string(), z.number().finite()).optional(),
  referenced_tweets: z.array(xReferencedTweetSchema).optional(),
  reply_settings: z.string().max(64).optional(),
  in_reply_to_user_id: z.string().regex(/^\d+$/).optional(),
  edit_history_tweet_ids: z.array(z.string().regex(/^\d+$/)).optional(),
  possibly_sensitive: z.boolean().optional(),
  entities: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const xProviderErrorSchema = z.object({
  detail: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  parameter: z.string().optional(),
  value: z.string().optional(),
  status: z.number().int().optional(),
}).passthrough();

export const xSearchResponseSchema = z.object({
  data: z.array(z.unknown()).optional(),
  includes: z.object({ users: z.array(z.unknown()).optional() }).passthrough().optional(),
  errors: z.array(xProviderErrorSchema).optional(),
  meta: z.object({
    result_count: z.number().int().nonnegative().optional(),
    next_token: z.string().trim().min(1).optional(),
    newest_id: z.string().regex(/^\d+$/).optional(),
    oldest_id: z.string().regex(/^\d+$/).optional(),
  }).passthrough().optional(),
}).passthrough();

export const xPostLookupResponseSchema = z.object({
  data: xTweetSchema.nullable().optional(),
  includes: z.object({ users: z.array(z.unknown()).optional() }).passthrough().optional(),
  errors: z.array(xProviderErrorSchema).optional(),
}).passthrough();

export const xRawItemPayloadSchema = z.object({
  tweet: xTweetSchema,
  author: xUserSchema.nullable().optional(),
}).passthrough();

export const xRequestMetadataSchema = z.object({
  internalWorkspaceId: z.string().uuid().optional(),
  postId: z.string().regex(/^\d{1,30}$/).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  maxPages: z.number().int().min(1).max(2).default(1),
  maxBillablePostsPerDiscovery: z.number().int().min(1).max(1_000).optional(),
  lang: z.string().regex(/^[A-Za-z]{2,8}$/).optional(),
  from: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional(),
  to: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional(),
  hasLinks: z.boolean().optional(),
  excludeRetweets: z.boolean().default(true),
  excludeReplies: z.boolean().default(false),
}).passthrough();

export type XRequestMetadata = z.infer<typeof xRequestMetadataSchema>;
export type XTweet = z.infer<typeof xTweetSchema>;
export type XUser = z.infer<typeof xUserSchema>;
export type XSearchResponse = z.infer<typeof xSearchResponseSchema>;
export type XPostLookupResponse = z.infer<typeof xPostLookupResponseSchema>;
