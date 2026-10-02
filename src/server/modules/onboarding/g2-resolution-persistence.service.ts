import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import type { SourceExecutionResult } from "@/server/modules/ingestion/public-ingestion.service";
import { g2MappingsFromSourceFilters, g2SourceFiltersWithMappings, type G2ProductMapping } from "@/server/providers/source/g2/product-resolution";

/** Product-specific G2 resolution state stays outside globally shared ingestion. */
export async function persistG2Resolutions(
  client: SupabaseClient<Database>,
  context: { workspaceId: string; productId: string },
  resolutions: SourceExecutionResult["resolutions"],
): Promise<void> {
  if (!resolutions?.length) return;
  const existing = await client.from("discovery_strategies").select("filters")
    .eq("workspace_id", context.workspaceId)
    .eq("product_id", context.productId)
    .eq("source_key", "g2")
    .eq("strategy_version", 1)
    .maybeSingle();
  if (existing.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be loaded.", 500, { providerMessage: existing.error.message });
  const mappings = g2MappingsFromSourceFilters(existing.data?.filters);
  for (const resolution of resolutions) mappings[resolution.targetKey] = resolution as G2ProductMapping;
  const filters = g2SourceFiltersWithMappings(existing.data?.filters, mappings);
  const saved = await client.from("discovery_strategies").upsert({
    workspace_id: context.workspaceId,
    product_id: context.productId,
    source_key: "g2",
    strategy_version: 1,
    filters,
    is_active: true,
  }, { onConflict: "workspace_id,product_id,source_key,strategy_version" }).select("id").single();
  if (saved.error) throw new AppError("INTERNAL_ERROR", "G2 source metadata could not be stored.", 500, { providerMessage: saved.error.message });
}
