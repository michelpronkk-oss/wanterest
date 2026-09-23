import { z } from "zod";

export const reviewRecordSchema = z.object({
  externalId: z.string().trim().min(1).max(500),
  title: z.string().max(1_000).optional(),
  text: z.string().max(100_000),
  rating: z.number().min(0).max(5).nullable().optional(),
  authorExternalId: z.string().trim().max(500).optional(),
  authorDisplayName: z.string().trim().max(500).optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  canonicalUrl: z.string().url().optional(),
  language: z.string().trim().max(32).optional(),
  verified: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
