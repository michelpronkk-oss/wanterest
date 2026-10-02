import "server-only";

import { z } from "zod";
import { requireAdminPermission } from "./auth";
import { createAdminServiceClient } from "./supabase";

const nullableCount = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative()).nullable();
const nullableRatio = z.union([z.number(), z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)]).transform(Number).pipe(z.number().min(0).max(1)).nullable();
const projectionRowSchema = z.object({
  vertical_key: z.string().min(1), market_key: z.string().min(1), partition_key: z.string().min(1),
  source_family: z.string().min(1), evidence_role: z.enum(["demand", "supply", "context"]),
  geography_code: z.string().nullable(), language_code: z.string().nullable(), surface_subtype: z.string().nullable(),
  relevance_state: z.enum(["relevant", "unknown"]),
  availability_state: z.enum(["unknown", "unavailable", "inactive", "active"]),
  rights_state: z.enum(["unknown", "permitted", "restricted", "unavailable"]),
  coverage_state: z.enum(["unknown", "unavailable", "inactive", "undercovered", "observed", "healthy", "stale", "concentrated"]),
  window_start: z.string().datetime({ offset: true }), window_end: z.string().datetime({ offset: true }),
  independent_roots: nullableCount, provider_count: nullableCount, provider_root_attributions: nullableCount,
  duplicate_root_ratio: nullableRatio, max_provider_root_share: nullableRatio,
  duplicate_observations: nullableCount, observed_source_items: nullableCount,
  published_month_buckets: nullableCount, roots_without_published_time: nullableCount,
  distinct_geographies: nullableCount, roots_without_geography: nullableCount,
  interested_products: nullableCount, latest_observed_at: z.string().datetime({ offset: true }).nullable(),
});

export type MarketCoverageAdminRow = z.infer<typeof projectionRowSchema>;
export type MarketCoverageAdminSnapshot = {
  state: "available" | "empty" | "unavailable";
  source: string;
  checkedAt: string;
  rows: MarketCoverageAdminRow[] | null;
};

/** Admin Operations read boundary: verifies permission before reading the service-only summary RPC. */
export async function getMarketCoverageAdminSnapshot(): Promise<MarketCoverageAdminSnapshot> {
  await requireAdminPermission("operations.read");
  const checkedAt = new Date().toISOString();
  const client = createAdminServiceClient();
  if (!client) return { state: "unavailable", source: "Supabase · market_coverage_summary_v1", checkedAt, rows: null };

  const { data, error } = await client.rpc("market_coverage_summary_v1");
  if (error || !Array.isArray(data)) {
    return { state: "unavailable", source: "Supabase · market_coverage_summary_v1", checkedAt, rows: null };
  }
  const parsed = z.array(projectionRowSchema).safeParse(data);
  if (!parsed.success) return { state: "unavailable", source: "Supabase · market_coverage_summary_v1", checkedAt, rows: null };
  return {
    state: parsed.data.length ? "available" : "empty",
    source: "Supabase · market_coverage_summary_v1 · reviewed coverage metadata only",
    checkedAt,
    rows: parsed.data,
  };
}
