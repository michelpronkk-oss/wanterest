import "server-only";

import type { CrossProductRoute } from "./cross-product-routing.schemas";

type QueryResult<T> = { data: T | null; error: { code?: string; message?: string } | null };
type Query = { upsert(value: Record<string, unknown>, options?: Record<string, unknown>): Query; select(value?: string): Query; eq(field: string, value: unknown): Query; maybeSingle(): Promise<QueryResult<Record<string, unknown>>> };
type Client = { from(table: "product_routing_edges"): Query };

export type PersistedRoutingEdge = CrossProductRoute & { id: string; createdAt: string; updatedAt: string; wasExisting: boolean };

function persistenceError(error: { code?: string; message?: string } | null, context: string): Error {
  return new Error(`Cross-product routing persistence failed during ${context}${error?.code ? ` (${error.code})` : ""}: ${(error?.message ?? "unknown error").slice(0, 180)}`);
}

export class CrossProductRoutingRepository {
  constructor(private readonly client: unknown) {}

  async upsertEdge(route: CrossProductRoute): Promise<PersistedRoutingEdge> {
    const client = this.client as Client;
    const identity = {
      workspace_id: route.workspaceId,
      product_id: route.productId,
      conversation_id: route.conversationId,
      routing_version: route.routingVersion,
      profile_version: route.profileVersion,
      evidence_fingerprint: route.evidenceFingerprint,
      profile_fingerprint: route.profileFingerprint,
    };
    const existing = await client.from("product_routing_edges").select("id").eq("workspace_id", identity.workspace_id).eq("product_id", identity.product_id).eq("conversation_id", identity.conversation_id).eq("routing_version", identity.routing_version).eq("profile_version", identity.profile_version).eq("evidence_fingerprint", identity.evidence_fingerprint).eq("profile_fingerprint", identity.profile_fingerprint).maybeSingle();
    if (existing.error) throw persistenceError(existing.error, "edge identity lookup");
    const query = client.from("product_routing_edges").upsert({
      workspace_id: route.workspaceId,
      product_id: route.productId,
      conversation_id: route.conversationId,
      routing_version: route.routingVersion,
      profile_version: route.profileVersion,
      evidence_fingerprint: route.evidenceFingerprint,
      profile_fingerprint: route.profileFingerprint,
      route_fingerprint: route.routeFingerprint,
      route_type: route.routeType,
      route_status: route.status,
      route_score: route.score,
      route_reason: route.reason,
    }, { onConflict: "workspace_id,product_id,conversation_id,routing_version,profile_fingerprint,evidence_fingerprint" }).select("*");
    const result = await query.maybeSingle();
    if (result.error || !result.data) throw persistenceError(result.error, "edge upsert");
    return {
      id: String(result.data.id),
      workspaceId: String(result.data.workspace_id),
      productId: String(result.data.product_id),
      conversationId: String(result.data.conversation_id),
      routingVersion: route.routingVersion,
      profileVersion: route.profileVersion,
      evidenceFingerprint: String(result.data.evidence_fingerprint),
      profileFingerprint: String(result.data.profile_fingerprint),
      routeFingerprint: String(result.data.route_fingerprint),
      routeType: route.routeType,
      status: route.status,
      score: Number(result.data.route_score),
      reason: route.reason,
      createdAt: String(result.data.created_at),
      updatedAt: String(result.data.updated_at),
      wasExisting: Boolean(existing.data),
    };
  }
}
