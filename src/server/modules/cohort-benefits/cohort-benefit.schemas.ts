import { z } from "zod";

export const cohortBenefitStatuses = ["eligible", "active", "expired", "revoked"] as const;
export type CohortBenefitStatus = (typeof cohortBenefitStatuses)[number];

export const cohortBenefitProviderStatuses = ["not_required", "pending", "applied", "mismatch", "unsupported"] as const;
export type CohortBenefitProviderStatus = (typeof cohortBenefitProviderStatuses)[number];

export const cohortBenefitReadModelSchema = z.object({
  workspaceId: z.string().uuid(),
  membershipId: z.string().uuid().nullable(),
  cohort: z.enum(["founding_25", "early_100", "none"]),
  cohortNumber: z.number().int().positive().nullable(),
  cohortLimit: z.union([z.literal(25), z.literal(100)]).nullable(),
  displayIdentity: z.enum(["Founding 25", "Early 100"]).nullable(),
  benefit: z.object({
    policyKey: z.string().min(1),
    discountPercent: z.number().int().min(1).max(100),
    durationMonths: z.number().int().min(1).max(120),
    status: z.enum(cohortBenefitStatuses),
    grantedAt: z.string().datetime({ offset: true }),
    activatedAt: z.string().datetime({ offset: true }).nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    activationSubscriptionId: z.string().uuid().nullable(),
    externalDiscountReference: z.string().nullable(),
    providerDiscountStatus: z.enum(cohortBenefitProviderStatuses),
  }).nullable(),
});

export type CohortBenefitReadModel = z.infer<typeof cohortBenefitReadModelSchema>;

export function effectiveCohortBenefitStatus(
  status: CohortBenefitStatus,
  expiresAt: string | null,
  now = new Date(),
): CohortBenefitStatus {
  if (status === "active" && expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return "expired";
  return status;
}
