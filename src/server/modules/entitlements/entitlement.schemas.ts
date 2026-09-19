import { z } from "zod";

export const capabilitySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const workspaceIdSchema = z.string().uuid();
export const usageTypeSchema = z.enum([
  "qualified_signal",
  "source_scan",
  "action_generated",
  "experiment_created",
  "export",
]);

export const consumeUsageInputSchema = z.object({
  workspaceId: z.string().uuid(),
  usageType: usageTypeSchema,
  amount: z.number().int().positive().max(1_000_000),
  idempotencyKey: z.string().trim().min(1).max(200),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
  traceId: z.string().trim().max(120).optional(),
});

export type EntitlementValue = boolean | number | string;
export type ConsumeUsageInput = z.infer<typeof consumeUsageInputSchema>;
