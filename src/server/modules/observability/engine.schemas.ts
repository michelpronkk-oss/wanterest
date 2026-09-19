import { z } from "zod";

export const engineTypeSchema = z.enum([
  "profile",
  "classifier",
  "matcher",
  "ranker",
  "map",
  "gap",
  "drift",
  "action",
]);

export const registerEngineVersionInputSchema = z.object({
  engineType: engineTypeSchema,
  version: z.string().trim().min(1).max(120),
  model: z.string().trim().max(120).nullable().optional(),
  promptVersion: z.string().trim().max(120).nullable().optional(),
  configHash: z.string().trim().max(200).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type RegisterEngineVersionInput = z.infer<typeof registerEngineVersionInputSchema>;
