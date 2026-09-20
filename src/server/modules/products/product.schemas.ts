import { z } from "zod";

const slugSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const productIdSchema = z.string().uuid();
export const workspaceIdSchema = z.string().uuid();

export const createProductInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  websiteUrl: z.string().url().max(2_000).nullable().optional(),
});

export const updateProductMetadataInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  websiteUrl: z.string().url().max(2_000).nullable().optional(),
});

export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductMetadataInput = z.infer<typeof updateProductMetadataInputSchema>;
