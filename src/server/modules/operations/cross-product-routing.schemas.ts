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
  evidenceSeen: number;
  routingProfilesConsidered: number;
  deterministicPrefilterMatches: number;
  directRoutes: number;
  categoryRoutes: number;
  competitorRoutes: number;
  candidateProducts: number;
  capSkips: number;
  routesCreated: number;
  routesReused: number;
  routesRejectedDownstream: number;
  routeMissShadow: number;
  routeExtraShadow: number;
  semanticCalls: number;
};
