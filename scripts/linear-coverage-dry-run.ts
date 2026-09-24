import { createClient } from "@supabase/supabase-js";
import { readBusinessClassification, readDemandProfileV2, readDemandProfileV2RoutingModel } from "@/server/modules/intelligence";
import { buildQueryPlan, buildSourceRoutingPlan } from "@/server/modules/operations";
import { initialSourceAvailability } from "@/server/modules/operations/source-control.service";
import type { Database } from "@/server/db/database.types";
import type { SourceRoutingHealthStatus } from "@/server/modules/operations/source-routing.schemas";

const workspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
const productId = "c5946172-6bef-45c0-a5da-08aedc9294cd";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Supabase service credentials are required.");
const client = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: product, error } = await client.from("products").select("current_snapshot_id").eq("workspace_id", workspaceId).eq("id", productId).single();
if (error || !product?.current_snapshot_id) throw new Error("Linear snapshot unavailable.");
const { data: snapshot, error: snapshotError } = await client.from("product_snapshots").select("*").eq("id", product.current_snapshot_id).single();
if (snapshotError || !snapshot) throw new Error("Linear snapshot unavailable.");
const profile = readDemandProfileV2(snapshot);
if (!profile) throw new Error("Linear Demand Profile v2 unavailable.");
const [{ data: controls }, { data: health }] = await Promise.all([
  client.from("source_controls").select("source_key,state,reason,next_retry_at"),
  client.from("source_health").select("source_key,degradation_state").eq("environment", "production"),
]);
const controlsBySource = new Map((controls ?? []).map((row) => [row.source_key, row]));
const healthBySource = new Map((health ?? []).map((row) => [row.source_key, row.degradation_state]));
const sourceStates = initialSourceAvailability.filter((source) => source.sourceKey !== "fixture").map((source) => {
  const control = controlsBySource.get(source.sourceKey);
  const retryPaused = Boolean(control?.next_retry_at && control.next_retry_at > new Date().toISOString() && control.state === "enabled");
  const degradation = healthBySource.get(source.sourceKey);
  const healthStatus: SourceRoutingHealthStatus = degradation === "healthy" || degradation === "degraded" || degradation === "blocked" ? degradation : "unknown";
  return { sourceKey: source.sourceKey, configured: source.configured, controlState: retryPaused ? "paused" : control?.state ?? "enabled", healthStatus, reason: source.configured ? control?.reason : source.reason };
});
const routing = buildSourceRoutingPlan({ productId, classification: readBusinessClassification(snapshot), demandProfile: readDemandProfileV2RoutingModel(profile), sourceStates, scanMode: "manual", totalCandidateBudget: 60, maxSources: 6, safetyCaps: { x: { maxCandidates: 10, maxPages: 1 } } });
const plan = buildQueryPlan({ classification: readBusinessClassification(snapshot), demandProfile: readDemandProfileV2RoutingModel(profile), sourceRoutingPlan: routing, scanMode: "manual", maxQueries: 16 });
console.log(JSON.stringify({ version: plan.version, selectedSources: routing.diagnostics.selected_sources, excluded: routing.excluded_sources, queriesPerSource: plan.diagnostics.queries_per_source, queriesPerSurface: plan.diagnostics.demand_surface_coverage, queryFamilies: plan.diagnostics.query_family_distribution, candidateBudgetPerSource: plan.diagnostics.candidate_budget_per_source, totalQueries: plan.diagnostics.query_count, sourceCaps: Object.fromEntries(routing.routes.filter((route) => route.max_candidates > 0).map((route) => [route.source_key, { candidates: route.max_candidates, pages: route.max_pages }])) }, null, 2));
