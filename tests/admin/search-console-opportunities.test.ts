import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifySearchQuery, getBrandBreakdown } from "../../apps/admin/src/server/search-console/brand";
import { buildSearchConsoleOpportunityReport } from "../../apps/admin/src/server/search-console/report";
import type { SearchConsoleReadySnapshot, SearchConsoleRow } from "../../apps/admin/src/server/search-console/model";

function row(key: string, clicks: number, impressions: number, ctr = impressions ? clicks / impressions : 0, position = 12): SearchConsoleRow {
  return { key, clicks, impressions, ctr, position };
}

function ready(overrides: Partial<SearchConsoleReadySnapshot> = {}): SearchConsoleReadySnapshot {
  return {
    state: "available",
    property: "sc-domain:wanterest.com",
    source: "Google Search Console · Search Analytics API",
    checkedAt: "2026-09-30T12:00:00.000Z",
    permission: "siteRestrictedUser",
    period: { startDate: "2026-08-30", endDate: "2026-09-26", days: 28 },
    comparison: { startDate: "2026-08-02", endDate: "2026-08-29", days: 28 },
    metrics: { clicks: 20, impressions: 400, ctr: 0.05, position: 10 },
    previousMetrics: { clicks: 15, impressions: 300, ctr: 0.05, position: 11 },
    queries: [
      row("wanterest.com", 1, 250, 0.004, 4),
      row("team knowledge base", 3, 160, 3 / 160, 14),
      row("workflow research", 4, 160, 0.025, 7),
    ],
    previousQueries: [
      row("wanterest.com", 1, 200, 0.005, 5),
      row("team knowledge base", 2, 100, 0.02, 16),
      row("workflow research", 3, 80, 0.0375, 8),
    ],
    pages: [row("https://www.wanterest.com/product", 1, 50, 0.02, 12), row("https://www.wanterest.com/about", 2, 300, 2 / 300, 13), row("https://www.wanterest.com/about", 2, 300, 2 / 300, 13)],
    previousPages: [row("https://www.wanterest.com/product", 4, 120, 4 / 120, 9)],
    queryPages: [],
    previousQueryPages: [],
    freshness: { state: "provisional", latestAvailableDate: "2026-09-29", firstIncompleteDate: "2026-09-28", detail: "Recent is provisional." },
    rowLimit: 1000,
    ...overrides,
  };
}

describe("Search Console brand and opportunity rules", () => {
  it("matches only whole-word Wanterest brand variants", () => {
    expect(classifySearchQuery("Wanterest")).toBe("branded");
    expect(classifySearchQuery("wanterest.com login")).toBe("branded");
    expect(classifySearchQuery("wanterest founder program")).toBe("branded");
    expect(classifySearchQuery("notwanterest")).toBe("non_branded");
    expect(classifySearchQuery("éwanterest")).toBe("non_branded");
    expect(classifySearchQuery("interest in product research")).toBe("non_branded");
  });

  it("sums brand classes over returned rows only", () => {
    expect(getBrandBreakdown([
      row("wanterest", 2, 20),
      row("wanterest.com login", 1, 8),
      row("demand research", 4, 40),
    ])).toEqual({
      branded: { clicks: 3, impressions: 28, rows: 2 },
      nonBranded: { clicks: 4, impressions: 40, rows: 1 },
      totalReturnedRows: 3,
    });
    expect(getBrandBreakdown([])).toBeNull();
  });

  it("generates only threshold-qualified, evidence-backed signals and suppresses duplicate entities", () => {
    const snapshot = ready({
      queries: [
        row("wanterest.com", 1, 250, 0.004, 4),
        row("team knowledge base", 3, 160, 3 / 160, 14),
        row("team knowledge base", 3, 160, 3 / 160, 14),
        row("workflow research", 4, 160, 0.025, 7),
        row("tiny sample", 0, 24, 0, 18),
      ],
    });
    const first = buildSearchConsoleOpportunityReport(snapshot);
    const second = buildSearchConsoleOpportunityReport(snapshot);
    expect(first.opportunities.map((opportunity) => opportunity.type)).toEqual(expect.arrayContaining([
      "high_impressions_weak_ctr",
      "near_page_one",
      "rising_query",
      "declining_page",
    ]));
    expect(new Set(first.opportunities.map((opportunity) => opportunity.id)).size).toBe(first.opportunities.length);
    expect(first.opportunities.map((opportunity) => opportunity.id)).toEqual(second.opportunities.map((opportunity) => opportunity.id));
    expect(first.opportunities.some((opportunity) => opportunity.entity === "tiny sample")).toBe(false);
    expect(first.opportunities.filter((opportunity) => opportunity.type === "high_impressions_weak_ctr" && opportunity.entityKind === "page" && opportunity.entity.endsWith("/about"))).toHaveLength(1);
    expect(first.opportunities.every((opportunity) => opportunity.confidence === "sufficient_sample" && opportunity.reason && opportunity.suggestedReview)).toBe(true);
  });

  it("does not create rising or declining signals without a comparable row", () => {
    const snapshot = ready({ previousQueries: [], previousPages: [] });
    const report = buildSearchConsoleOpportunityReport(snapshot);
    expect(report.opportunities.some((opportunity) => opportunity.type === "rising_query")).toBe(false);
    expect(report.opportunities.some((opportunity) => opportunity.type === "declining_page")).toBe(false);
  });
});
