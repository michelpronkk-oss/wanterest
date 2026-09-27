import { z } from "zod";

const optionalNullableString = z.string().nullable().optional();

export const devtoUserSchema = z.object({
  user_id: z.number().int().positive().optional(),
  name: optionalNullableString,
  username: optionalNullableString,
  website_url: optionalNullableString,
}).passthrough();

export const devtoArticleSchema = z.object({
  id: z.number().int().positive(),
  type_of: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  body_markdown: z.string().optional(),
  tag_list: z.array(z.string()).optional(),
  tags: z.string().optional(),
  slug: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  canonical_url: z.string().optional(),
  published_at: optionalNullableString,
  published_timestamp: optionalNullableString,
  created_at: optionalNullableString,
  edited_at: optionalNullableString,
  last_comment_at: optionalNullableString,
  comments_count: z.number().int().nonnegative().optional(),
  public_reactions_count: z.number().int().nonnegative().optional(),
  positive_reactions_count: z.number().int().nonnegative().optional(),
  user: devtoUserSchema.optional(),
}).passthrough();

export type DevtoComment = {
  [key: string]: unknown;
  type_of?: string;
  id_code: string;
  created_at?: string | null;
  body_html?: string;
  user?: z.infer<typeof devtoUserSchema>;
  children?: DevtoComment[];
};

export const devtoCommentSchema: z.ZodType<DevtoComment> = z.object({
  type_of: z.string().optional(),
  id_code: z.string().trim().min(1).max(200),
  created_at: optionalNullableString,
  body_html: z.string().optional(),
  user: devtoUserSchema.optional(),
  children: z.array(z.lazy(() => devtoCommentSchema)).optional(),
}).passthrough();

export const devtoArticleSearchResponseSchema = z.array(devtoArticleSchema);
export const devtoCommentsResponseSchema = z.array(devtoCommentSchema);

export const devtoRequestMetadataSchema = z.object({
  maxPages: z.number().int().min(1).max(2).default(1),
  maxArticlesToExpand: z.number().int().min(0).max(4).default(4),
  maxCommentsPerArticle: z.number().int().min(0).max(8).default(8),
  includeComments: z.boolean().default(false),
  topDays: z.number().int().positive().max(3650).optional(),
}).passthrough();

export type DevtoArticle = z.infer<typeof devtoArticleSchema>;
