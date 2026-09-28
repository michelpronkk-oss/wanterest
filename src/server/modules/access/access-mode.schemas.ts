import { z } from "zod";

export const accessModes = ["waitlist", "invite_only", "open"] as const;
export type AccessMode = (typeof accessModes)[number];

export const accessModeSchema = z.enum(accessModes);

export const accessPolicySchema = z.object({
  mode: accessModeSchema,
  waitlistRequestsAllowed: z.boolean(),
  referralSystemActive: z.boolean(),
  inviteIssuanceAllowed: z.boolean(),
  inviteAcceptanceAllowed: z.boolean(),
  publicSignupAllowed: z.boolean(),
  inviteRequiredForAdmission: z.boolean(),
});
export type AccessPolicy = z.infer<typeof accessPolicySchema>;

export const publicAccessStateSchema = z.object({
  mode: accessModeSchema,
  canRequestAccess: z.boolean(),
  canSignUp: z.boolean(),
  inviteRequired: z.boolean(),
});
export type PublicAccessState = z.infer<typeof publicAccessStateSchema>;

export const accessModeChangeInputSchema = z.object({
  mode: accessModeSchema,
  reason: z.string().trim().min(1).max(240),
  actorUserId: z.string().uuid().nullable().optional(),
});
