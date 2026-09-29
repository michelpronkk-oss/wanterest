import { z } from "zod";

export const shareCardVariants = ["EARLY_ACCESS", "PRIORITY_ACCESS", "FOUNDING_25", "EARLY_100"] as const;
export const shareCardVariantSchema = z.enum(shareCardVariants);
export type ShareCardVariant = z.infer<typeof shareCardVariantSchema>;

export const shareCardToneSchema = z.enum(["neutral", "priority", "founding", "early"]);
export type ShareCardTone = z.infer<typeof shareCardToneSchema>;

export const shareCardActionSchema = z.enum(["publish", "revoke"]);
export type ShareCardAction = z.infer<typeof shareCardActionSchema>;

export const shareCardEventTypeSchema = z.enum(["opened", "cta_clicked", "shared", "downloaded"]);
export type ShareCardEventType = z.infer<typeof shareCardEventTypeSchema>;

export const shareCardEventSourceSchema = z.enum(["page", "x", "linkedin", "copy", "download", "cta"]);
export type ShareCardEventSource = z.infer<typeof shareCardEventSourceSchema>;

export const shareCardMutationInputSchema = z.object({
  action: shareCardActionSchema,
  variant: shareCardVariantSchema,
}).strict();

export const shareCardEventInputSchema = z.object({
  publicSlug: z.string().regex(/^[A-Za-z0-9_-]{32,96}$/),
  eventType: shareCardEventTypeSchema,
  source: shareCardEventSourceSchema.nullable().optional().default(null),
}).strict();

const safeDisplayName = z.string().trim().min(1).max(160);
const safeHeadline = z.string().trim().max(240).nullable();

const safeMonogram = z.string().regex(/^[A-Z0-9]{1,3}$/).nullable();
const safeAdmittedOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

/**
 * Board 15 renders only these values. `identityNumber` is the card's number: the Early Access
 * number for EARLY_ACCESS and PRIORITY_ACCESS, the cohort seat for FOUNDING_25 / EARLY_100.
 * `monogram` and `admittedOn` exist only on cohort cards (the workspace identity tile and
 * "Admitted <Month YYYY>").
 */
export const shareCardSnapshotSchema = z.object({
  displayName: safeDisplayName,
  headline: safeHeadline,
  identityLabel: z.string().trim().min(1).max(80),
  identityNumber: z.number().int().positive().nullable(),
  tone: shareCardToneSchema,
  isPermanent: z.boolean(),
  monogram: safeMonogram.optional().default(null),
  admittedOn: safeAdmittedOn.optional().default(null),
}).strict();

export type ShareCardSnapshot = z.infer<typeof shareCardSnapshotSchema>;

export const shareCardPreviewSchema = shareCardSnapshotSchema.extend({
  variant: shareCardVariantSchema,
  publicationId: z.string().uuid().nullable(),
  publicSlug: z.string().regex(/^[A-Za-z0-9_-]{32,96}$/).nullable(),
  publicationState: z.enum(["published", "revoked"]).nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});

export type ShareCardPreview = z.infer<typeof shareCardPreviewSchema>;

export const publicShareCardSchema = z.object({
  publicSlug: z.string().regex(/^[A-Za-z0-9_-]{32,96}$/),
  variant: shareCardVariantSchema,
  displayName: z.string().nullable(),
  headline: z.string().nullable(),
  identityLabel: z.string(),
  identityNumber: z.number().int().positive().nullable(),
  tone: shareCardToneSchema,
  isPermanent: z.boolean(),
  monogram: safeMonogram,
  admittedOn: safeAdmittedOn,
  publishedAt: z.string().datetime({ offset: true }),
  accessMode: z.enum(["waitlist", "invite_only", "open"]),
  ctaLabel: z.string().min(1).max(80),
  ctaHref: z.string().regex(/^\/(?:waitlist|signup|r\/)[^\s]*$/),
  canonicalUrl: z.string().url(),
  ogTitle: z.string().min(1).max(160),
  ogDescription: z.string().min(1).max(240),
});

export type PublicShareCard = z.infer<typeof publicShareCardSchema>;

export type ShareCardAuthority = {
  ownerKind: "applicant" | "workspace";
  ownerId: string;
  workspaceId: string | null;
  waitlistApplicationId: string | null;
  variant: ShareCardVariant;
  snapshot: ShareCardSnapshot;
};

export type ShareCardPublication = {
  id: string;
  workspaceId: string | null;
  waitlistApplicationId: string | null;
  variant: ShareCardVariant;
  publicSlug: string;
  publicationState: "published" | "revoked";
  snapshot: ShareCardSnapshot;
  publishedAt: string;
  revokedAt: string | null;
};
