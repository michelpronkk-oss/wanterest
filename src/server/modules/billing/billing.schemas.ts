import { z } from "zod";

export const billingPlanSchema = z.enum(["pro", "growth"]);
export const billingIntervalSchema = z.enum(["monthly", "annual"]);
export const workspaceIdSchema = z.string().uuid();

export const createCheckoutInputSchema = z.object({
  // The active workspace is resolved server-side for browser checkout. The
  // optional field keeps trusted/internal callers backwards compatible.
  workspaceId: workspaceIdSchema.optional(),
  plan: billingPlanSchema,
  cadence: billingIntervalSchema.optional(),
  // Kept as a compatibility alias for existing callers; new clients submit cadence.
  interval: billingIntervalSchema.optional(),
  returnUrl: z.string().url().optional(),
  // This is an application idempotency key, never a provider product/price.
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
}).superRefine((value, context) => {
  if (!value.cadence && !value.interval) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cadence"], message: "Billing cadence is required." });
  if (value.cadence && value.interval && value.cadence !== value.interval) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cadence"], message: "Billing cadence values must match." });
});

export const billingWorkspaceInputSchema = z.object({ workspaceId: workspaceIdSchema });

export const changePlanInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  plan: billingPlanSchema,
  interval: billingIntervalSchema,
});

export type BillingPlan = z.infer<typeof billingPlanSchema>;
export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export type CreateCheckoutInput = z.infer<typeof createCheckoutInputSchema>;
export type ChangePlanInput = z.infer<typeof changePlanInputSchema>;
