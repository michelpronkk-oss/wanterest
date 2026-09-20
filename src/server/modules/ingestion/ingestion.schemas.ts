import { z } from "zod";

import { sourceKeySchema, timestampSchema } from "../../providers/source/contracts";

export const replayInputSchema = z.object({
  sourceKey: sourceKeySchema.optional(),
  rawSourceItemIds: z.array(z.string().uuid()).max(500).optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  normalizationVersion: z.string().trim().min(1).max(120),
  canonicalizationVersion: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(10_000).default(1000),
  traceId: z.string().trim().min(1).max(120).optional(),
});

export type ReplayInput = z.infer<typeof replayInputSchema>;
