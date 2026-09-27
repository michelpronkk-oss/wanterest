import "server-only";

import type { ProductRow } from "@/server/db/database.helpers";
import { CrossProductRoutingRepository } from "./cross-product-routing.repository";
import { crossProductRoutingShadowEnabled } from "./cross-product-routing.config";
import { profileInputFromDemandProfile } from "./cross-product-routing.service";
import { runCrossProductRoutingShadow } from "./cross-product-routing-shadow.service";
import type { CrossProductRoutingTelemetry, ProductRoutingProfile, PublicRoutingEvidence } from "./cross-product-routing.schemas";

type QueryResult<T> = { data: T[] | null; error: { message?: string } | null };
type Query = { select(columns: string): Query; eq(field: string, value: unknown): Query; in(field: string, values: unknown[]): Query; order(field: string, options: { ascending: boolean }): Query; limit(count: number): Promise<QueryResult<Record<string, unknown>>>; maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }> };
type Client = { from(table: "conversations" | "source_items" | "demand_profiles"): Query };

function rowError(context: string, error: { message?: string } | null): Error {
  return new Error(`${context}: ${error?.message ?? "unknown database error"}`);
}

async function routingProfile(client: Client, product: ProductRow): Promise<ProductRoutingProfile | null> {
  if (!product.current_demand_profile_id) return null;
  const { data, error } = await client.from("demand_profiles").select("include_terms, problems, desired_outcomes, jobs, capabilities, alternatives").eq("workspace_id", product.workspace_id).eq("product_id", product.id).eq("id", product.current_demand_profile_id).maybeSingle();
  if (error) throw rowError("Demand profile could not be loaded for cross-product routing", error);
  if (!data) return null;
  return profileInputFromDemandProfile({
    workspaceId: product.workspace_id,
    productId: product.id,
    productName: product.name,
    categories: [data.capabilities],
    jobs: [data.jobs],
    pains: [data.problems],
    features: [data.capabilities],
    competitors: [data.alternatives],
    comparisonTerms: [data.include_terms, data.alternatives],
  });
}

export async function runCrossProductRoutingShadowForRefresh(input: {
  client: unknown;
  workspaceIds: string[];
  products: ProductRow[];
  conversationIds: string[];
  env?: Record<string, string | undefined>;
}): Promise<CrossProductRoutingTelemetry | null> {
  const products = input.products.filter((product) => input.workspaceIds.includes(product.workspace_id));
  if (!products.some((product) => crossProductRoutingShadowEnabled(input.env, product.workspace_id)) || !products.length || !input.conversationIds.length) return null;
  const client = input.client as Client;
  const conversationQuery = await client.from("conversations").select("id,content_hash,title,body,published_at,primary_source_item_id").in("id", [...new Set(input.conversationIds)].slice(0, 50)).limit(50);
  if (conversationQuery.error) throw rowError("Conversations could not be loaded for cross-product routing", conversationQuery.error);
  const conversations = (conversationQuery.data ?? []) as Array<Record<string, unknown>>;
  const sourceIds = conversations.map((row) => row.primary_source_item_id).filter((value): value is string => typeof value === "string");
  const sourceQuery: QueryResult<Record<string, unknown>> = sourceIds.length ? await client.from("source_items").select("id,source_key").in("id", sourceIds).limit(sourceIds.length) : { data: [], error: null };
  if (sourceQuery.error) throw rowError("Source items could not be loaded for cross-product routing", sourceQuery.error);
  const sourceById = new Map((sourceQuery.data ?? []).map((row) => [String(row.id), String(row.source_key)]));
  const evidence: PublicRoutingEvidence[] = conversations.map((row) => ({ conversationId: String(row.id), contentHash: String(row.content_hash), title: typeof row.title === "string" ? row.title : null, body: String(row.body ?? ""), sourceKey: sourceById.get(String(row.primary_source_item_id)) ?? "unknown", publishedAt: typeof row.published_at === "string" ? row.published_at : null }));
  const profiles = (await Promise.all(products.filter((product) => crossProductRoutingShadowEnabled(input.env, product.workspace_id)).map((product) => routingProfile(client, product)))).filter((profile): profile is ProductRoutingProfile => Boolean(profile));
  if (!profiles.length) return null;
  const existing = new Map(evidence.map((item) => [item.conversationId, new Set(profiles.map((profile) => profile.productId))]));
  const repository = new CrossProductRoutingRepository(input.client);
  const result = await runCrossProductRoutingShadow({ evidence, profiles, existingProductIdsByConversation: existing, persist: async (route) => {
    const edge = await repository.upsertEdge(route);
    return edge.wasExisting ? "reused" : "created";
  }});
  return result.telemetry;
}
