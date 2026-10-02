import { z } from "zod";

export const MARKET_SOURCE_FAMILY_TAXONOMY_VERSION = "market_source_family_v1" as const;
export const MARKET_EVIDENCE_ROLE_TAXONOMY_VERSION = "market_evidence_role_v1" as const;
export const MARKET_SOURCE_FAMILIES = [
  "social", "community_forum", "developer", "reviews", "alternative_comparison", "video",
  "first_party_company", "launch_directory", "broad_web", "news_editorial",
  "commercial_enrichment", "search_intent", "marketplace", "local_directory",
  "maps_reviews", "owned_survey", "owned_support", "owned_crm", "owned_form",
] as const;
export const MARKET_EVIDENCE_ROLES = ["demand", "supply", "context", "owned_private"] as const;
export const GLOBAL_MARKET_EVIDENCE_ROLES = ["demand", "supply", "context"] as const;
export const GLOBAL_MARKET_SOURCE_FAMILIES = [
  "social", "community_forum", "developer", "reviews", "alternative_comparison", "video",
  "first_party_company", "launch_directory", "broad_web", "news_editorial",
  "commercial_enrichment", "search_intent", "marketplace", "local_directory", "maps_reviews",
] as const;

export const marketSourceFamilySchema = z.enum(MARKET_SOURCE_FAMILIES);
export const globalMarketSourceFamilySchema = z.enum(GLOBAL_MARKET_SOURCE_FAMILIES);
export const marketEvidenceRoleSchema = z.enum(MARKET_EVIDENCE_ROLES);
export const globalMarketEvidenceRoleSchema = z.enum(GLOBAL_MARKET_EVIDENCE_ROLES);
export const marketCoverageStateSchema = z.enum([
  "unknown", "unavailable", "inactive", "undercovered", "observed", "healthy", "stale", "concentrated",
]);
export const marketCoverageAvailabilitySchema = z.enum(["unknown", "unavailable", "inactive", "active"]);
export const marketRightsStateSchema = z.enum(["unknown", "permitted", "restricted", "unavailable"]);

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){0,14}$/);
const verticalSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/);
const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/);
const nullableString = z.string().trim().min(1).max(240).nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const PRIVATE_FAMILY_SET = new Set(["owned_survey", "owned_support", "owned_crm", "owned_form"]);

/** Inputs are reviewed public taxonomy keys only. Tenant/product identifiers and query specs are rejected. */
export const marketCoverageIdentityInputSchema = z.object({
  verticalKey: verticalSchema,
  marketKey: slugSchema,
  sourceFamily: globalMarketSourceFamilySchema,
  geographyCode: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/).transform((value) => value.toUpperCase()).nullable().default(null),
  languageCode: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).transform((value) => value.toLowerCase()).nullable().default(null),
  surfaceSubtype: slugSchema.nullable().default(null),
}).strict();
export type MarketCoverageIdentityInput = z.input<typeof marketCoverageIdentityInputSchema>;

const optionalCount = z.number().int().nonnegative().nullable();

/** A typed adapter-neutral envelope. It carries metadata only; payload text is intentionally absent. */
export const normalizedConnectorEnvelopeSchema = z.object({
  providerKey: keySchema,
  sourceFamily: marketSourceFamilySchema,
  evidenceRole: marketEvidenceRoleSchema.nullable(),
  visibility: z.enum(["global_public", "workspace_private"]),
  providerNativeId: nullableString,
  canonicalSourceIdentity: nullableString,
  sourceUrl: z.string().url().nullable(),
  publishedAt: timestamp,
  retrievedAt: z.string().datetime({ offset: true }),
  firstSeenAt: timestamp,
  languageCode: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).transform((value) => value.toLowerCase()).nullable(),
  surfaceSubtype: slugSchema.nullable(),
  geography: z.object({ code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/).transform((value) => value.toUpperCase()), confidence: z.number().min(0).max(1) }).nullable(),
  conversationThreadIdentity: nullableString,
  authorEntityIdentity: nullableString,
  authorIdentityPermission: z.enum(["permitted", "unknown", "not_permitted"]),
  engagement: z.object({ replies: optionalCount, likes: optionalCount, shares: optionalCount, views: optionalCount }).nullable(),
  rightsProfileReference: nullableString,
  retentionClassReference: nullableString,
  publicProjectionEligibility: z.boolean().nullable(),
  rawContentPolicy: z.enum(["not_stored", "transient_only", "provider_retained", "wanterest_retained", "unknown"]),
  providerCost: z.object({ amount: z.number().nonnegative().nullable(), unit: z.string().trim().min(1).max(60) }).nullable(),
  rateLimit: z.object({ remaining: z.number().int().nonnegative().nullable(), retryAfterMs: z.number().int().nonnegative().nullable(), resetAt: timestamp }).nullable(),
}).strict().superRefine((value, context) => {
  if (value.visibility === "global_public" && (value.evidenceRole === "owned_private" || PRIVATE_FAMILY_SET.has(value.sourceFamily))) {
    context.addIssue({ code: "custom", path: ["evidenceRole"], message: "owned/private evidence cannot enter global Market Memory" });
  }
  if (value.authorEntityIdentity !== null && value.authorIdentityPermission !== "permitted") {
    context.addIssue({ code: "custom", path: ["authorEntityIdentity"], message: "author identity requires explicit permission" });
  }
});
export type NormalizedConnectorEnvelope = z.infer<typeof normalizedConnectorEnvelopeSchema>;

export const globalCoverageObservationSchema = z.object({
  partitionKey: z.string().regex(/^market_coverage_partition_v1:[0-9a-f]{64}$/),
  conversationId: z.string().uuid(),
  sourceItemId: z.string().uuid(),
  sourceFamily: globalMarketSourceFamilySchema,
  providerKey: keySchema,
  evidenceRole: globalMarketEvidenceRoleSchema.nullable(),
  observedAt: z.string().datetime({ offset: true }),
  geographyCode: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/).transform((value) => value.toUpperCase()).nullable(),
  geographyConfidence: z.number().min(0).max(1).nullable(),
  languageCode: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).transform((value) => value.toLowerCase()).nullable(),
  surfaceSubtype: slugSchema.nullable(),
  rightsProfileReference: nullableString,
  retentionClassReference: nullableString,
  publicProjectionEligibility: z.boolean().nullable(),
}).strict();
export type GlobalCoverageObservation = z.infer<typeof globalCoverageObservationSchema>;

export const coverageRightsInputSchema = z.object({
  state: marketRightsStateSchema,
  acquisitionAllowed: z.boolean().nullable(),
  durableAnalysisAllowed: z.boolean().nullable(),
  publicProjectionAllowed: z.boolean().nullable(),
  rawRetentionClass: z.string().nullable(),
});

export const coverageObservationInputSchema = z.object({
  conversationId: z.string().min(1),
  providerKey: keySchema,
  evidenceRole: globalMarketEvidenceRoleSchema.nullable(),
  observedAt: z.string().datetime({ offset: true }),
  publishedAt: timestamp,
  geographyCode: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/).transform((value) => value.toUpperCase()).nullable(),
  languageCode: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).transform((value) => value.toLowerCase()).nullable(),
  surfaceSubtype: slugSchema.nullable(),
});

export const coverageEvaluationInputSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  geographyCode: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/).transform((value) => value.toUpperCase()).nullable().default(null),
  languageCode: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).transform((value) => value.toLowerCase()).nullable().default(null),
  surfaceSubtype: slugSchema.nullable().default(null),
  availability: marketCoverageAvailabilitySchema,
  relevance: z.enum(["relevant", "unknown"]),
  expectedRole: globalMarketEvidenceRoleSchema,
  rights: coverageRightsInputSchema,
  observations: z.array(coverageObservationInputSchema),
  measurementWindowDays: z.number().int().positive().default(30),
  minimumIndependentRoots: z.number().int().positive(),
  freshnessDays: z.number().int().positive(),
  concentrationThreshold: z.number().min(0.5).max(1),
  duplicateThreshold: z.number().min(0.5).max(1),
});

export type MarketCoverageState = z.infer<typeof marketCoverageStateSchema>;
