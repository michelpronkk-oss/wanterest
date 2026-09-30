import "server-only";

export const ORGANIC_READINESS_FAMILIES = [
  { key: "public_market_intelligence", label: "Public Market Intelligence" },
  { key: "demand_opportunity", label: "Demand Opportunity" },
  { key: "company_competitor_intelligence", label: "Company / Competitor Intelligence" },
  { key: "trend_demand_drift", label: "Trend / Demand Drift" },
  { key: "geography_intelligence", label: "Geography Intelligence" },
  { key: "research_data_report", label: "Research / Data Report" },
] as const;

export function getOrganicReadinessSourceStatus() {
  return {
    state: "unavailable" as const,
    source: "Public-safe Organic Intelligence projection",
    detail: "No production read model currently provides reviewed, public-safe intelligence objects. Workspace-scoped demand rows and raw source records are intentionally excluded.",
    candidateCount: null,
    evaluatedAt: null,
    families: ORGANIC_READINESS_FAMILIES.map((family) => ({ ...family, state: "not_evaluated" as const })),
    searchConsole: "prioritization_only" as const,
    publicationEnabled: false as const,
  };
}
