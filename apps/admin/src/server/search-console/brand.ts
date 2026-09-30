import "server-only";

import type { SearchConsoleRow } from "./model";

export type SearchQueryClassification = "branded" | "non_branded";

export type BrandBreakdown = {
  branded: { clicks: number; impressions: number; rows: number };
  nonBranded: { clicks: number; impressions: number; rows: number };
  totalReturnedRows: number;
};

const brandPattern = /(^|[^\p{L}\p{N}_])wanterest(?:\.com)?(?=$|[^\p{L}\p{N}_])/iu;

export function classifySearchQuery(query: string): SearchQueryClassification {
  return brandPattern.test(query.normalize("NFKC").trim()) ? "branded" : "non_branded";
}

export function getBrandBreakdown(rows: SearchConsoleRow[]): BrandBreakdown | null {
  if (rows.length === 0) return null;
  const branded = { clicks: 0, impressions: 0, rows: 0 };
  const nonBranded = { clicks: 0, impressions: 0, rows: 0 };
  for (const row of rows) {
    const target = classifySearchQuery(row.key) === "branded" ? branded : nonBranded;
    target.clicks += row.clicks;
    target.impressions += row.impressions;
    target.rows += 1;
  }
  return { branded, nonBranded, totalReturnedRows: rows.length };
}
