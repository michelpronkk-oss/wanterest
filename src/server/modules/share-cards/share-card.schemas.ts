import { z } from "zod";

export const shareCardVariants = ["EARLY_ACCESS", "PRIORITY_ACCESS", "FOUNDING_25", "EARLY_100", "SIGNAL", "DEMAND_GAP", "DEMAND_DRIFT"] as const;
export const shareCardVariantSchema = z.enum(shareCardVariants);
export type ShareCardVariant = z.infer<typeof shareCardVariantSchema>;

export const intelligenceShareCardVariants = ["SIGNAL", "DEMAND_GAP", "DEMAND_DRIFT"] as const;
export const intelligenceShareCardVariantSchema = z.enum(intelligenceShareCardVariants);
export type IntelligenceShareCardVariant = z.infer<typeof intelligenceShareCardVariantSchema>;

export const shareCardKindSchema = z.enum(["identity", "intelligence"]);
export type ShareCardKind = z.infer<typeof shareCardKindSchema>;

export const shareCardToneSchema = z.enum(["neutral", "priority", "founding", "early", "signal", "gap", "drift"]);
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
  productId: z.string().uuid().nullable().optional().default(null),
  sourceId: z.string().uuid().nullable().optional().default(null),
}).strict();

export const shareCardEventInputSchema = z.object({
  publicSlug: z.string().regex(/^[A-Za-z0-9_-]{32,96}$/),
  eventType: shareCardEventTypeSchema,
  source: shareCardEventSourceSchema.nullable().optional().default(null),
}).strict();

const safeDisplayName = z.string().trim().min(1).max(160);
const safeHeadline = z.string().trim().max(240).nullable();

export const shareCardSnapshotSchema = z.object({
  displayName: safeDisplayName,
  headline: safeHeadline,
  identityLabel: z.string().trim().min(1).max(80),
  identityNumber: z.number().int().positive().nullable(),
  tone: shareCardToneSchema,
  isPermanent: z.boolean(),
  cardKind: shareCardKindSchema.default("identity"),
  claim: z.string().trim().max(320).nullable().default(null),
  evidence: z.string().trim().max(320).nullable().default(null),
  evidenceStrength: z.string().trim().max(120).nullable().default(null),
  contextLabel: z.string().trim().max(120).nullable().default(null),
  freshnessLabel: z.string().trim().max(120).nullable().default(null),
  sourceLabel: z.string().trim().max(120).nullable().default(null),
}).strict();

// Input-compatible on purpose: identity cards created by 13B.1 do not carry
// intelligence fields, while the parser supplies safe null defaults at the
// repository boundary.
export type ShareCardSnapshot = z.input<typeof shareCardSnapshotSchema>;

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
  cardKind: shareCardKindSchema,
  claim: z.string().nullable(),
  evidence: z.string().nullable(),
  evidenceStrength: z.string().nullable(),
  contextLabel: z.string().nullable(),
  freshnessLabel: z.string().nullable(),
  sourceLabel: z.string().nullable(),
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
  productId?: string | null;
  sourceId?: string | null;
  sourceEvidenceNodeId?: string | null;
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
  productId?: string | null;
  sourceId?: string | null;
  sourceEvidenceNodeId?: string | null;
};
