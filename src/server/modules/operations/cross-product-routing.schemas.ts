import { z } from "zod";

export const crossProductRoutingVersion = "cross_product_routing_v1" as const;
export const productRoutingProfileVersion = "product_routing_profile_v1" as const;

/** Reuses the existing incremental product-matching fanout ceiling. */
export const CROSS_PRODUCT_ROUTING_MAX_PRODUCTS = 20;
export const CROSS_PRODUCT_ROUTING_MAX_CONVERSATIONS = 50;

export const crossProductRouteTypeSchema = z.enum(["direct", "category", "competitor"]);
export type CrossProductRouteType = z.infer<typeof crossProductRouteTypeSchema>;

export const crossProductRouteStatusSchema = z.enum(["eligible", "reused", "capped", "skipped"]);
export type CrossProductRouteStatus = z.infer<typeof crossProductRouteStatusSchema>;

export type ProductRoutingProfile = {
  workspaceId: string;
  productId: string;
  productName: string;
  profileVersion: typeof productRoutingProfileVersion;
  profileFingerprint: string;
  entityTerms: string[];
  categoryTerms: string[];
  jtbdTerms: string[];
  painTerms: string[];
  featureTerms: string[];
  competitorTerms: string[];
  comparisonTerms: string[];
};

export type PublicRoutingEvidence = {
  conversationId: string;
  contentHash: string;
  title: string | null;
  body: string;
  sourceKey: string;
  publishedAt: string | null;
};

export type CrossProductRoute = {
  workspaceId: string;
  productId: string;
  conversationId: string;
  routingVersion: typeof crossProductRoutingVersion;
  profileVersion: typeof productRoutingProfileVersion;
  evidenceFingerprint: string;
  profileFingerprint: string;
  routeFingerprint: string;
  routeType: CrossProductRouteType;
  status: CrossProductRouteStatus;
  score: number;
  reason: {
    matchedTerms: string[];
    mentionedCompetitors: string[];
    stage: "deterministic_entity" | "deterministic_category" | "deterministic_competitor" | "cap";
    commonWordGuard?: string;
  };
};

export type CrossProductRoutingTelemetry = {
  routingVersion: typeof crossProductRoutingVersion;
  shadowInvoked: boolean;
  evidenceSeen: number;
  conversationsExamined: number;
  routingProfilesConsidered: number;
  deterministicPrefilterMatches: number;
  directRoutes: number;
  categoryRoutes: number;
  competitorRoutes: number;
  noRouteDecisions: number;
  candidateProductsBeforeCap: number;
  candidateProductsAfterCap: number;
  candidateProducts: number;
  capSkips: number;
  conversationCapSkips: number;
  routesCreated: number;
  routesReused: number;
  routesRejectedDownstream: number;
  routeMissShadow: number;
  routeExtraShadow: number;
  semanticCalls: number;
};

export const crossProductRoutingTelemetrySchema = z.object({
  routingVersion: z.literal(crossProductRoutingVersion),
  shadowInvoked: z.boolean(),
  evidenceSeen: z.number().int().nonnegative(),
  conversationsExamined: z.number().int().nonnegative(),
  routingProfilesConsidered: z.number().int().nonnegative(),
  deterministicPrefilterMatches: z.number().int().nonnegative(),
  directRoutes: z.number().int().nonnegative(),
  categoryRoutes: z.number().int().nonnegative(),
  competitorRoutes: z.number().int().nonnegative(),
  noRouteDecisions: z.number().int().nonnegative(),
  candidateProductsBeforeCap: z.number().int().nonnegative(),
  candidateProductsAfterCap: z.number().int().nonnegative(),
  candidateProducts: z.number().int().nonnegative(),
  capSkips: z.number().int().nonnegative(),
  conversationCapSkips: z.number().int().nonnegative(),
  routesCreated: z.number().int().nonnegative(),
  routesReused: z.number().int().nonnegative(),
  routesRejectedDownstream: z.number().int().nonnegative(),
  routeMissShadow: z.number().int().nonnegative(),
  routeExtraShadow: z.number().int().nonnegative(),
  semanticCalls: z.number().int().nonnegative(),
});
