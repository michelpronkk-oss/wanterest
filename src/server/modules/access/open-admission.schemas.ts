import { z } from "zod";

export const openSignupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const openAdmissionResultSchema = z.object({
  admissionId: z.string().uuid(),
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  cohort: z.enum(["founding_25", "early_100"]).nullable(),
  cohortNumber: z.number().int().positive().nullable(),
  cohortLimit: z.number().int().positive().nullable(),
  benefitPolicyKey: z.string().nullable(),
  benefitStatus: z.enum(["eligible", "active", "expired", "revoked"]).nullable(),
  profileInitialized: z.boolean(),
  onboardingStatus: z.enum(["required", "completed"]),
  admittedAt: z.string(),
  idempotent: z.boolean(),
});
export type OpenAdmissionResult = z.infer<typeof openAdmissionResultSchema>;
