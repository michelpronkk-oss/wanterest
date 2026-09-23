import { z } from "zod";

import { geoSampleStateSchema, geoTrendSchema, type GeoPublicLocation, type GeoSampleState, type GeoTrend } from "./geo.schemas";

export const geographyWindowSchema = z.enum(["7d", "30d", "90d"]);
export type GeographyWindow = z.infer<typeof geographyWindowSchema>;

export const geographyLevelSchema = z.enum(["world", "country", "region"]);
export type GeographyLevel = z.infer<typeof geographyLevelSchema>;

export const geographyCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const geographyRegionCodeSchema = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,4}$/);

export type GeographyFilterSelection = {
  theme?: string | null;
  intent?: string | null;
  competitor?: string | null;
  source?: string | null;
};

export type GeographySelection = {
  countryCode?: string | null;
  regionCode?: string | null;
  filters?: GeographyFilterSelection;
};

function queryValue(value: string | string[] | undefined): string | undefined {
  const selected = Array.isArray(value) ? value[0] : value;
  const trimmed = selected?.trim();
  return trimmed ? trimmed.slice(0, 160) : undefined;
}

/** Parses shareable geography state without allowing arbitrary codes into server queries. */
export function parseGeographySelection(input: Record<string, string | string[] | undefined>): GeographySelection {
  const countryCode = queryValue(input.country)?.toUpperCase();
  const regionCode = queryValue(input.region)?.toUpperCase();
  const validCountry = countryCode && geographyCountryCodeSchema.safeParse(countryCode).success ? countryCode : undefined;
  const validRegion = regionCode && validCountry && geographyRegionCodeSchema.safeParse(regionCode).success && regionCode.startsWith(`${validCountry}-`) ? regionCode : undefined;
  const filters: GeographyFilterSelection = {
    theme: queryValue(input.theme) ?? null,
    intent: queryValue(input.intent) ?? null,
    competitor: queryValue(input.competitor) ?? null,
    source: queryValue(input.source) ?? null,
  };
  return { countryCode: validCountry ?? null, regionCode: validRegion ?? null, filters };
}

export type GeographySignalSummary = {
  id: string;
  source: string;
  excerpt: string;
  intent: string;
  theme: string | null;
  confidence: number;
  publishedAt: string | null;
};

export type GeographyMarketSummary = {
  id: string;
  level: "country" | "region";
  marketName: string;
  countryCode: string;
  countryName: string;
  regionCode: string | null;
  regionName: string | null;
  parentCountryCode: string | null;
  parentCountryName: string | null;
  qualifiedSignalCount: number;
  shareOfGeoQualifiedDemand: number;
  shareOfParentMarket: number;
  trend: GeoTrend;
  sampleState: GeoSampleState;
  availableForDrilldown: boolean;
  topDemandTheme: string | null;
  topPain: string | null;
  topIntent: string | null;
  topCompetitor: string | null;
  topSource: string | null;
  topFeatureDemand: string | null;
  regions: Array<{ regionCode: string | null; regionName: string; qualifiedSignalCount: number }>;
  representativeSignals: GeographySignalSummary[];
  recommendedAction: string | null;
};

export type GeographyAccessProjection = {
  enabled: boolean;
  historyDays: number;
  trendEnabled: boolean;
  maxMarkets: number;
  countryDrilldown: boolean;
  regionDrilldown?: boolean;
  regionalHistoryDays?: number;
  comparisonEnabled?: boolean;
  upgradeHint: string | null;
};

export type GeographyReadModel = {
  level: GeographyLevel;
  selectedCountryCode: string | null;
  selectedRegionCode: string | null;
  breadcrumb: Array<{ level: GeographyLevel; label: string; countryCode?: string; regionCode?: string }>;
  window: GeographyWindow;
  periodEnd: string;
  periodStart: string;
  totalQualifiedSignalCount: number;
  reliableGeoSignalCount: number;
  unknownGeoSignalCount: number;
  geoCoveragePercent: number;
  markets: GeographyMarketSummary[];
  topMarkets: GeographyMarketSummary[];
  fastestGrowing: GeographyMarketSummary[];
  selectedMarket: GeographyMarketSummary | null;
  parentMarket: GeographyMarketSummary | null;
  regionalDataAvailable: boolean;
  regionalQualifiedSignalCount: number;
  regionalCoveragePercent: number;
  coverage: { label: string; percent: number; numerator: number; denominator: number; description: string };
  access: GeographyAccessProjection;
  filters: { themes: string[]; intents: string[]; competitors: string[]; sources: string[] };
};

export type GeoAggregationSignal = {
  id: string;
  conversationId: string;
  source: string;
  observedAt: string;
  publishedAt: string | null;
  location: GeoPublicLocation;
  confidence: number;
  excerpt: string;
  intent: string;
  themes: string[];
  pains: string[];
  features: string[];
  competitors: string[];
};

export type GeoAggregationInput = {
  current: GeoAggregationSignal[];
  previous: GeoAggregationSignal[];
  periodEnd: string;
  periodStart: string;
  window: GeographyWindow;
  access: GeographyAccessProjection;
  selection?: GeographySelection;
};

export { geoSampleStateSchema, geoTrendSchema };
