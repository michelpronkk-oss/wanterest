import { z } from "zod";

const atUriSchema = z.string().regex(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/);

const authorSchema = z.object({
  did: z.string().regex(/^did:[a-z0-9]+:.+$/),
  handle: z.string().trim().min(1).max(500).optional(),
  displayName: z.string().max(500).optional(),
  location: z.string().max(500).nullable().optional(),
}).passthrough();

const replyReferenceSchema = z.object({
  root: z.object({ uri: atUriSchema, cid: z.string().trim().min(1) }).passthrough(),
  parent: z.object({ uri: atUriSchema, cid: z.string().trim().min(1) }).passthrough(),
}).passthrough();

export const blueskyRecordSchema = z.object({
  text: z.string().max(100_000),
  createdAt: z.string().datetime({ offset: true }),
  langs: z.array(z.string().trim().min(2).max(35)).max(20).optional(),
  reply: replyReferenceSchema.optional(),
  embed: z.unknown().optional(),
}).passthrough();

export const blueskyPostSchema = z.object({
  uri: atUriSchema,
  cid: z.string().trim().min(1).max(500),
  author: authorSchema,
  record: blueskyRecordSchema,
  labels: z.array(z.object({ val: z.string().trim().min(1).max(120) }).passthrough()).max(100).optional(),
  likeCount: z.number().int().nonnegative().optional(),
  repostCount: z.number().int().nonnegative().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  quoteCount: z.number().int().nonnegative().optional(),
}).passthrough();

export const blueskyQuoteEmbedSchema = z.object({
  record: z.object({ uri: atUriSchema, cid: z.string().trim().min(1).max(500) }).passthrough(),
}).passthrough();

export const blueskyQuoteWithMediaEmbedSchema = z.object({
  record: blueskyQuoteEmbedSchema,
}).passthrough();

export const blueskySearchResponseSchema = z.object({
  posts: z.array(z.unknown()),
  cursor: z.string().trim().min(1).optional(),
}).passthrough();

export const blueskyRequestMetadataSchema = z.object({
  lang: z.string().trim().min(2).max(35).optional(),
  langs: z.array(z.string().trim().min(2).max(35)).max(10).optional(),
  sort: z.enum(["latest", "top"]).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
}).passthrough();

export type BlueskyPost = z.infer<typeof blueskyPostSchema>;
export type BlueskySearchResponse = z.infer<typeof blueskySearchResponseSchema>;
