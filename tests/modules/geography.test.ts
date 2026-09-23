import { describe, expect, it } from "vitest";

import { enrichSourceMetadata, extractGeoEvidence } from "../../src/server/modules/geography/geo-enrichment";
import { normalizeGeoEvidence, resolveGeoLocation } from "../../src/server/modules/geography/geo-resolver";
import { parseGeographySelection } from "../../src/server/modules/geography/geography.schemas";
import { aggregateGeoIntelligence, type GeoAggregationSignal } from "../../src/server/modules/geography/geography.service";
import { getPlanCapabilities } from "../../src/server/modules/entitlements/plan-capabilities";

function location(countryCode: string | null, countryName: string | null, confidence: "high" | "medium" | "low" | "unknown" = "high", city: string | null = null, regionCode: string | null = null, regionName: string | null = null) {
  return { countryCode, countryName, regionCode, regionName, city, confidence, evidenceType: confidence === "high" ? "provider_country" as const : confidence === "medium" ? "public_profile_location" as const : confidence === "low" ? "language_only" as const : "unknown" as const };
}

function signal(id: string, geo: ReturnType<typeof location>, overrides: Partial<GeoAggregationSignal> = {}): GeoAggregationSignal {
  return { id, conversationId: id, source: "github", observedAt: "2026-09-20T00:00:00.000Z", publishedAt: "2026-09-20T00:00:00.000Z", location: geo, confidence: 0.8, excerpt: "Need a more predictable workflow.", intent: "switching_intent", themes: ["pricing predictability"], pains: ["pricing"], features: ["sso"], competitors: ["Competitor X"], ...overrides };
}

describe("Geo resolver", () => {
  it("resolves country codes and names without geocoding", () => {
    expect(resolveGeoLocation("US")).toMatchObject({ countryCode: "US", countryName: "United States", confidence: "high" });
    expect(resolveGeoLocation("Deutschland")).toMatchObject({ countryCode: "DE", countryName: "Germany" });
  });

  it("resolves city-country aliases conservatively", () => {
    expect(resolveGeoLocation("Amsterdam")).toMatchObject({ countryCode: "NL", city: "Amsterdam", confidence: "medium" });
    expect(resolveGeoLocation("Berlin, Germany")).toMatchObject({ countryCode: "DE", city: "Berlin" });
    expect(resolveGeoLocation("Toronto")).toMatchObject({ countryCode: "CA", regionCode: "CA-ON" });
    expect(resolveGeoLocation("NYC")).toMatchObject({ countryCode: "US", regionCode: "US-NY", city: "New York" });
    expect(resolveGeoLocation("Bay Area")).toMatchObject({ countryCode: "US", regionCode: "US-CA" });
  });

  it("prefers unknown over false precision", () => {
    expect(resolveGeoLocation("Georgia")).toMatchObject({ countryCode: null, confidence: "unknown" });
    expect(resolveGeoLocation("somewhere near the coast")).toMatchObject({ countryCode: null, confidence: "low" });
  });

  it("resolves canonical subdivisions and city-to-region evidence", () => {
    expect(resolveGeoLocation("California")).toMatchObject({ countryCode: "US", regionCode: "US-CA", regionName: "California" });
    expect(resolveGeoLocation("Ontario")).toMatchObject({ countryCode: "CA", regionCode: "CA-ON" });
    expect(resolveGeoLocation("Bavaria")).toMatchObject({ countryCode: "DE", regionCode: "DE-BY" });
    expect(resolveGeoLocation("Noord-Holland")).toMatchObject({ countryCode: "NL", regionCode: "NL-NH" });
    expect(resolveGeoLocation("Sydney")).toMatchObject({ countryCode: "AU", regionCode: "AU-NSW" });
    expect(resolveGeoLocation("London")).toMatchObject({ countryCode: null, confidence: "unknown" });
    expect(resolveGeoLocation("London, UK")).toMatchObject({ countryCode: "GB", regionCode: "GB-LND" });
  });

  it("does not guess ambiguous abbreviations or conflicting city context", () => {
    for (const value of ["CA", "GA", "WA", "Victoria", "Georgia"]) expect(resolveGeoLocation(value)).toMatchObject({ countryCode: null, confidence: "unknown" });
    expect(resolveGeoLocation("San Francisco, CA")).toMatchObject({ countryCode: "US", regionCode: "US-CA" });
    expect(resolveGeoLocation("Toronto, CA")).toMatchObject({ countryCode: null });
    expect(resolveGeoLocation("United States")).toMatchObject({ countryCode: "US", regionCode: null });
  });
});

describe("source geo enrichment", () => {
  it("uses explicit provider/profile fields and persists the normalized result", () => {
    const metadata = enrichSourceMetadata({ authorLocation: "Berlin" }, { sourceKey: "github" });
    expect(metadata.geo).toMatchObject({ countryCode: "DE", city: "Berlin", confidence: "medium", evidenceType: "public_profile_location" });
    expect(extractGeoEvidence({ sourceKey: "g2", metadata: { countryCode: "CA" } })).toMatchObject({ countryCode: "CA", confidence: "high", evidenceType: "review_region" });
    expect(extractGeoEvidence({ sourceKey: "public-web", metadata: { profileLocation: "Toronto" } })).toMatchObject({ countryCode: "CA", regionCode: "CA-ON" });
    expect(normalizeGeoEvidence({ countryCode: "US", countryName: "United States", regionCode: "CA", regionName: "California", city: null, confidence: "medium", evidenceType: "public_profile_location", rawLocation: "California" })).toMatchObject({ regionCode: "US-CA" });
  });

  it("keeps weak or unavailable source geography out of hard claims", () => {
    expect(extractGeoEvidence({ sourceKey: "youtube", metadata: {}, language: "en" })).toMatchObject({ countryCode: null, confidence: "low", evidenceType: "language_only" });
    expect(extractGeoEvidence({ sourceKey: "hacker-news", metadata: {} })).toMatchObject({ countryCode: null, confidence: "unknown" });
    expect(extractGeoEvidence({ sourceKey: "github", metadata: {} })).toMatchObject({ countryCode: null, confidence: "unknown" });
  });
});

describe("Geo aggregation", () => {
  it("includes high and medium, excludes low and unknown, and derives market facets", () => {
    const current = [
      signal("us-1", location("US", "United States")),
      signal("us-2", location("US", "United States", "medium", "New York"), { source: "g2", themes: ["compliance"], pains: ["compliance"], competitors: ["Competitor X"] }),
      signal("ca-1", location("CA", "Canada", "medium", "Toronto"), { intent: "purchase_research" }),
      signal("low-1", location(null, null, "low")),
      signal("unknown-1", location(null, null, "unknown")),
    ];
    const result = aggregateGeoIntelligence({
      current,
      previous: [signal("us-old-1", location("US", "United States"))],
      periodEnd: "2026-09-23T00:00:00.000Z",
      periodStart: "2026-08-24T00:00:00.000Z",
      window: "30d",
      access: { enabled: true, historyDays: 30, trendEnabled: true, maxMarkets: 6, countryDrilldown: true, upgradeHint: null },
    });
    expect(result.totalQualifiedSignalCount).toBe(5);
    expect(result.reliableGeoSignalCount).toBe(3);
    expect(result.unknownGeoSignalCount).toBe(2);
    expect(result.geoCoveragePercent).toBe(60);
    expect(result.topMarkets[0]).toMatchObject({ countryCode: "US", qualifiedSignalCount: 2, topCompetitor: "Competitor X" });
    expect(result.markets.find((market) => market.countryCode === "CA")?.topIntent).toBe("purchase_research");
  });

  it("uses conservative sample states and only reports trends with a baseline", () => {
    const current = Array.from({ length: 5 }, (_, index) => signal(`us-${index}`, location("US", "United States")));
    const result = aggregateGeoIntelligence({ current, previous: Array.from({ length: 5 }, (_, index) => signal(`old-${index}`, location("US", "United States"))), periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access: { enabled: true, historyDays: 30, trendEnabled: true, maxMarkets: 6, countryDrilldown: true, upgradeHint: null } });
    expect(result.markets[0]?.sampleState).toBe("emerging");
    expect(result.markets[0]?.trend.hasEnoughHistory).toBe(true);
    expect(result.markets[0]?.trend.percentage).toBe(0);
    const noHistory = aggregateGeoIntelligence({ current, previous: [], periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access: { enabled: true, historyDays: 0, trendEnabled: false, maxMarkets: 3, countryDrilldown: false, upgradeHint: "Upgrade" } });
    expect(noHistory.markets[0]?.trend).toMatchObject({ percentage: null, hasEnoughHistory: false, direction: "insufficient_data" });
  });

  it("supports world to country to region aggregation without assigning country-only signals", () => {
    const current = [
      ...Array.from({ length: 5 }, (_, index) => signal(`ca-${index}`, location("US", "United States", "medium", null, "US-CA", "California"), { themes: ["automation"], pains: ["workflow"], intent: "purchase_research" })),
      ...Array.from({ length: 2 }, (_, index) => signal(`ny-${index}`, location("US", "United States", "medium", null, "US-NY", "New York"), { themes: ["pricing"], pains: ["pricing"], intent: "switching_intent" })),
      signal("country-1", location("US", "United States"), { themes: ["country-wide"] }),
      signal("country-2", location("US", "United States"), { themes: ["country-wide"] }),
    ];
    const access = { enabled: true, historyDays: 30, trendEnabled: true, maxMarkets: 6, countryDrilldown: true, regionDrilldown: true, regionalHistoryDays: 30, comparisonEnabled: true, upgradeHint: null };
    const country = aggregateGeoIntelligence({ current, previous: current, periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access, selection: { countryCode: "US" } });
    expect(country.level).toBe("country");
    expect(country.totalQualifiedSignalCount).toBe(9);
    expect(country.regionalQualifiedSignalCount).toBe(7);
    expect(country.regionalCoveragePercent).toBe(77.8);
    expect(country.markets).toHaveLength(2);
    expect(country.markets[0]).toMatchObject({ id: "US-CA", qualifiedSignalCount: 5, shareOfParentMarket: 5 / 9, availableForDrilldown: true });

    const region = aggregateGeoIntelligence({ current, previous: current, periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access, selection: { countryCode: "US", regionCode: "US-CA" } });
    expect(region.level).toBe("region");
    expect(region.selectedRegionCode).toBe("US-CA");
    expect(region.totalQualifiedSignalCount).toBe(5);
    expect(region.selectedMarket?.representativeSignals.every((item) => item.id.startsWith("ca-"))).toBe(true);
    expect(region.selectedMarket).toMatchObject({ marketName: "California", shareOfParentMarket: 5 / 9, topDemandTheme: "automation", topIntent: "purchase_research", topPain: "workflow" });
  });

  it("keeps regional claims unavailable below the five-signal threshold and falls back from missing regions", () => {
    const current = [
      signal("ca-1", location("US", "United States", "medium", null, "US-CA", "California"), { pains: ["other"] }),
      signal("ca-2", location("US", "United States", "medium", null, "US-CA", "California"), { pains: ["other"] }),
      signal("country-1", location("US", "United States")), signal("country-2", location("US", "United States")), signal("country-3", location("US", "United States")), signal("country-4", location("US", "United States")),
    ];
    const access = { enabled: true, historyDays: 30, trendEnabled: true, maxMarkets: 6, countryDrilldown: true, regionDrilldown: true, upgradeHint: null };
    const result = aggregateGeoIntelligence({ current, previous: [], periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access, selection: { countryCode: "US", regionCode: "US-CA" } });
    expect(result.level).toBe("country");
    expect(result.selectedRegionCode).toBeNull();
    expect(result.regionalDataAvailable).toBe(false);
    expect(result.markets).toHaveLength(0);
  });

  it("applies server-side filters while retaining the country context", () => {
    const current = [
      ...Array.from({ length: 5 }, (_, index) => signal(`ca-${index}`, location("US", "United States", "medium", null, "US-CA", "California"), { themes: ["automation"], pains: ["workflow"] })),
      signal("country-1", location("US", "United States"), { themes: ["pricing"] }),
    ];
    const result = aggregateGeoIntelligence({ current, previous: [], periodEnd: "2026-09-23T00:00:00.000Z", periodStart: "2026-08-24T00:00:00.000Z", window: "30d", access: { enabled: true, historyDays: 30, trendEnabled: true, maxMarkets: 6, countryDrilldown: true, regionDrilldown: true, upgradeHint: null }, selection: { countryCode: "US", regionCode: "US-CA", filters: { theme: "pricing" } } });
    expect(result.level).toBe("country");
    expect(result.selectedCountryCode).toBe("US");
    expect(result.selectedRegionCode).toBeNull();
  });
});

describe("Geo URL state", () => {
  it("accepts canonical state and rejects invalid or mismatched region parameters", () => {
    expect(parseGeographySelection({ country: "us", region: "us-ca", theme: "automation" })).toMatchObject({ countryCode: "US", regionCode: "US-CA", filters: { theme: "automation" } });
    expect(parseGeographySelection({ country: "bad", region: "US-CA" })).toMatchObject({ countryCode: null, regionCode: null });
    expect(parseGeographySelection({ country: "CA", region: "US-CA" })).toMatchObject({ countryCode: "CA", regionCode: null });
  });
});

describe("Geo plan projection", () => {
  it("keeps current coverage available while gating history", () => {
    expect(getPlanCapabilities("free").geography).toMatchObject({ enabled: true, historyDays: 0, trendEnabled: false, maxMarkets: 3, countryDrilldown: false, regionDrilldown: false, regionalHistoryDays: 0 });
    expect(getPlanCapabilities("pro").geography).toMatchObject({ historyDays: 30, trendEnabled: true, countryDrilldown: true, regionDrilldown: true, regionalHistoryDays: 30 });
    expect(getPlanCapabilities("growth").geography).toMatchObject({ historyDays: 90, trendEnabled: true, countryDrilldown: true, regionDrilldown: true, regionalHistoryDays: 90, comparisonEnabled: true });
  });
});
