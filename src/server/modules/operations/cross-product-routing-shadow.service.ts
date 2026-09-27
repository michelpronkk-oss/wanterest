import type { CrossProductRoute, CrossProductRoutingTelemetry, ProductRoutingProfile, PublicRoutingEvidence } from "./cross-product-routing.schemas";
import { compareCrossProductRouting, routePublicEvidence } from "./cross-product-routing.service";

export type CrossProductRoutingShadowInput = {
  evidence: PublicRoutingEvidence[];
  profiles: ProductRoutingProfile[];
  existingProductIdsByConversation: Map<string, Set<string>>;
  maxProducts?: number;
  persist?: (route: CrossProductRoute) => Promise<"created" | "reused">;
};

export type CrossProductRoutingShadowResult = {
  routes: CrossProductRoute[];
  telemetry: CrossProductRoutingTelemetry;
};

function emptyTelemetry(): CrossProductRoutingTelemetry {
  return {
    routingVersion: "cross_product_routing_v1",
    shadowInvoked: true,
    evidenceSeen: 0,
    conversationsExamined: 0,
    routingProfilesConsidered: 0,
    deterministicPrefilterMatches: 0,
    directRoutes: 0,
    categoryRoutes: 0,
    competitorRoutes: 0,
    noRouteDecisions: 0,
    candidateProductsBeforeCap: 0,
    candidateProductsAfterCap: 0,
    candidateProducts: 0,
    capSkips: 0,
    conversationCapSkips: 0,
    routesCreated: 0,
    routesReused: 0,
    routesRejectedDownstream: 0,
    routeMissShadow: 0,
    routeExtraShadow: 0,
    semanticCalls: 0,
  };
}

export async function runCrossProductRoutingShadow(input: CrossProductRoutingShadowInput): Promise<CrossProductRoutingShadowResult> {
  const telemetry = emptyTelemetry();
  const routes: CrossProductRoute[] = [];
  for (const evidence of input.evidence.slice(0, 50)) {
    const result = routePublicEvidence({
      evidence,
      profiles: input.profiles,
      maxProducts: input.maxProducts,
      existingProductIds: input.existingProductIdsByConversation.get(evidence.conversationId),
    });
    routes.push(...result.routes);
    for (const key of ["evidenceSeen", "conversationsExamined", "routingProfilesConsidered", "deterministicPrefilterMatches", "directRoutes", "categoryRoutes", "competitorRoutes", "noRouteDecisions", "candidateProductsBeforeCap", "candidateProductsAfterCap", "candidateProducts", "capSkips", "conversationCapSkips"] as const) telemetry[key] += result.telemetry[key];
    const comparison = compareCrossProductRouting({ existingProductIds: input.existingProductIdsByConversation.get(evidence.conversationId) ?? new Set(), routes: result.routes });
    telemetry.routeMissShadow += comparison.routeMissShadow;
    telemetry.routeExtraShadow += comparison.routeExtraShadow;
    for (const route of result.routes) {
      if (!input.persist) continue;
      const state = await input.persist(route);
      if (state === "reused") telemetry.routesReused += 1;
      else telemetry.routesCreated += 1;
    }
  }
  if (!input.persist) {
    telemetry.routesCreated = routes.filter((route) => route.status === "eligible").length;
    telemetry.routesReused = routes.filter((route) => route.status === "reused").length;
  }
  return { routes, telemetry };
}
