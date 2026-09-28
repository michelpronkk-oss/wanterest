import { z } from "zod";

export const admissionInviteStatuses = ["issued", "accepted", "expired", "revoked"] as const;
export type AdmissionInviteStatus = (typeof admissionInviteStatuses)[number];

export const admissionStatuses = ["not_admitted", "admitted"] as const;
export type AdmissionStatus = (typeof admissionStatuses)[number];

export const onboardingStatuses = ["required", "completed"] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export const waitlistAdmissionApplicationIdSchema = z.string().uuid();
export const waitlistAdmissionInviteIdSchema = z.string().uuid();
export const waitlistAdmissionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,160}$/);

export const admissionInviteSchema = z.object({
  inviteId: z.string().uuid(),
  waitlistApplicationId: z.string().uuid(),
  recipientEmail: z.string().email(),
  firstName: z.string().min(1),
  companyName: z.string().min(1),
  status: z.enum(admissionInviteStatuses),
  issuedAt: z.string(),
  expiresAt: z.string(),
  reissued: z.boolean(),
});
export type AdmissionInvite = z.infer<typeof admissionInviteSchema>;

export const admissionResultSchema = z.object({
  admissionId: z.string().uuid(),
  inviteId: z.string().uuid(),
  waitlistApplicationId: z.string().uuid(),
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  cohort: z.enum(["founding_25", "early_100"]).nullable(),
  cohortNumber: z.number().int().positive().nullable(),
  cohortLimit: z.number().int().positive().nullable(),
  benefitPolicyKey: z.string().nullable(),
  benefitStatus: z.enum(["eligible", "active", "expired", "revoked"]).nullable(),
  profileInitialized: z.boolean(),
  onboardingStatus: z.enum(onboardingStatuses),
  admittedAt: z.string(),
  idempotent: z.boolean(),
});
export type AdmissionResult = z.infer<typeof admissionResultSchema>;

export const waitlistAdmissionStatusSchema = z.object({
  applicationStatus: z.string(),
  inviteStatus: z.enum(admissionInviteStatuses).nullable(),
  inviteExpiresAt: z.string().nullable(),
  admissionStatus: z.enum(admissionStatuses),
  admissionId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid().nullable(),
  cohort: z.enum(["founding_25", "early_100"]).nullable(),
  cohortNumber: z.number().int().positive().nullable(),
  cohortLimit: z.number().int().positive().nullable(),
  displayIdentity: z.string().nullable(),
  benefitPolicyKey: z.string().nullable(),
  benefitDiscountPercent: z.number().int().positive().nullable(),
  benefitDurationMonths: z.number().int().positive().nullable(),
  benefitStatus: z.enum(["eligible", "active", "expired", "revoked"]).nullable(),
  onboardingStatus: z.enum(onboardingStatuses).nullable(),
  admittedAt: z.string().nullable(),
});
export type WaitlistAdmissionStatus = z.infer<typeof waitlistAdmissionStatusSchema>;
