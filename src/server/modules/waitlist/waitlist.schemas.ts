import { z } from "zod";

export const waitlistStatuses = ["pending", "verified", "under_review", "approved_for_invite", "declined", "withdrawn"] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];

const boundedOptionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const boundedOptionalUrl = z.string().trim().max(240).refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}, "Enter a valid public website URL.").optional().or(z.literal(""));

export const waitlistApplicationInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  companyName: z.string().trim().min(1).max(160),
  companyWebsite: boundedOptionalUrl,
  roleTitle: boundedOptionalText(120),
  useCase: z.string().trim().min(1).max(1200),
  marketingConsent: z.boolean().default(false),
  honeypot: z.string().max(240).optional(),
  source: boundedOptionalText(80),
  utmSource: boundedOptionalText(120),
  utmMedium: boundedOptionalText(120),
  utmCampaign: boundedOptionalText(160),
  utmContent: boundedOptionalText(160),
  utmTerm: boundedOptionalText(160),
  referrerCategory: boundedOptionalText(120),
  referralCode: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/).optional().or(z.literal("")),
}).strict();

export const waitlistStatusTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,160}$/);
export const waitlistVerificationTokenSchema = waitlistStatusTokenSchema;
export const waitlistApplicationIdSchema = z.string().uuid();
export const waitlistReferralCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{32,80}$/);

export const waitlistReviewListSchema = z.object({
  status: z.enum(waitlistStatuses).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
});

export const waitlistReviewTransitionSchema = z.object({
  toStatus: z.enum(["under_review", "approved_for_invite", "declined", "withdrawn"] as const),
  reason: z.string().trim().max(500).optional(),
});

export type WaitlistApplicationInput = z.infer<typeof waitlistApplicationInputSchema>;
