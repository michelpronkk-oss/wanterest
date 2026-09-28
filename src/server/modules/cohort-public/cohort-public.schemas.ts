import { z } from "zod";

export const publicCohortTypeSchema = z.enum(["founding_25", "early_100"]);
export type PublicCohortType = z.infer<typeof publicCohortTypeSchema>;

const reservedPublicSlugs = new Set([
  "api", "app", "auth", "about", "contact", "early", "founding", "forgot-password",
  "login", "members", "privacy", "r", "signup", "start", "terms", "waitlist",
]);

export function normalizePublicSlug(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export const publicSlugSchema = z.string().trim().min(3).max(80).transform(normalizePublicSlug).superRefine((value, context) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){0,11}$/.test(value)) context.addIssue({ code: "custom", message: "Public slug contains unsupported characters." });
  if (reservedPublicSlugs.has(value)) context.addIssue({ code: "custom", message: "That public slug is reserved." });
});

const httpsUrlSchema = z.string().trim().max(2048).url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are allowed.");

export const publicProfileInputSchema = z.object({
  publicSlug: publicSlugSchema,
  displayName: z.string().trim().min(1).max(160),
  logoUrl: httpsUrlSchema.nullable().optional().default(null),
  avatarUrl: httpsUrlSchema.nullable().optional().default(null),
  monogram: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/).nullable().optional().default(null),
  headline: z.string().trim().min(1).max(240).nullable().optional().default(null),
  websiteUrl: httpsUrlSchema.nullable().optional().default(null),
  wallVisible: z.boolean().default(false),
  passVisible: z.boolean().default(false),
}).strict();

export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;

export const publicCohortRowSchema = z.object({
  publicSlug: publicSlugSchema,
  displayName: z.string(),
  logoUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  monogram: z.string().nullable(),
  headline: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  cohort: publicCohortTypeSchema,
  number: z.number().int().positive(),
  limit: z.union([z.literal(25), z.literal(100)]),
  assignedAt: z.string().datetime({ offset: true }),
});

export type PublicCohortRow = z.infer<typeof publicCohortRowSchema>;

export const privatePublicProfileSchema = publicCohortRowSchema.extend({
  profileId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  wallVisible: z.boolean(),
  passVisible: z.boolean(),
});

export type PrivatePublicProfile = z.infer<typeof privatePublicProfileSchema>;

export type PublicCohortPass = PublicCohortRow & { canonicalUrl: string };

export function derivePublicMonogram(displayName: string): string {
  const words = displayName.normalize("NFKC").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) ?? "WN";
  return value.toUpperCase().slice(0, 3);
}
