import { z } from "zod";

export const billingPlanSchema = z.enum(["pro", "growth"]);
export const billingIntervalSchema = z.enum(["monthly", "annual"]);
export const workspaceIdSchema = z.string().uuid();

export const createCheckoutInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  plan: billingPlanSchema,
  interval: billingIntervalSchema,
  returnUrl: z.string().url().optional(),
  // This is an application idempotency key, never a provider product/price.
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
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

