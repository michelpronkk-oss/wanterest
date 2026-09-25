import type { ConversationAnalysisRow, ConversationRow, DemandObservationRow, ProductRow, SignalRow, SourceItemRow } from "../../db/database.helpers";
import { extractGeoEvidence, publicGeoEvidence } from "./geo-enrichment";
import { geoEvidenceSchema, type GeoPublicLocation } from "./geo.schemas";
import { geographyWindowSchema, type GeoAggregationInput, type GeoAggregationSignal, type GeographyAccessProjection, type GeographyFilterSelection, type GeographyLevel, type GeographyMarketSummary, type GeographyReadModel, type GeographySelection, type GeographySignalSummary, type GeographyWindow } from "./geography.schemas";
import { windowStart } from "../demand-intelligence/demand.schemas";
import type { DemandRepository } from "../demand-intelligence/demand.repository";
import type { IntelligenceRepository } from "../intelligence/intelligence.repository";

export type { GeoAggregationSignal } from "./geography.schemas";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 180)) : []; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function windowLength(window: GeographyWindow): number { return Number(window.slice(0, -1)); }
function sampleState(count: number): GeographyMarketSummary["sampleState"] { if (count < 5) return "insufficient_data"; if (count < 15) return "emerging"; if (count < 30) return "directional"; return "higher_confidence"; }
function trend(currentCount: number, previousCount: number, historyEnabled: boolean) {
  const enough = historyEnabled && previousCount >= 5 && currentCount >= 5;
  if (!enough) return { currentCount, previousCount, percentage: null, direction: "insufficient_data" as const, hasEnoughHistory: false };
  const percentage = Math.round(((currentCount - previousCount) / previousCount) * 1000) / 10;
  return { currentCount, previousCount, percentage, direction: percentage > 3 ? "growing" as const : percentage < -3 ? "cooling" as const : "stable" as const, hasEnoughHistory: true };
}
function topValue(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}
function publicLocation(value: unknown): GeoPublicLocation {
  const parsed = geoEvidenceSchema.safeParse(value);
  if (!parsed.success) return { countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "unknown", evidenceType: "unknown" };
  return publicGeoEvidence(parsed.data) as GeoPublicLocation;
}
function competitorValues(source: SourceItemRow, analysis: ConversationAnalysisRow | undefined): string[] {
  const metadata = record(source.metadata);
  const direct = [metadata.competitor, metadata.mentionedCompetitor, metadata.competitorName].filter((value): value is string => typeof value === "string");
  const lists = [metadata.competitors, metadata.mentionedCompetitors].flatMap(strings);
  const competitiveContext = metadata.competitiveContext === true || metadata.sourceCategory === "review" || metadata.sourceCategory === "comparison";
  return unique([...direct, ...lists, ...(competitiveContext ? strings(analysis?.alternatives) : [])]).slice(0, 8);
}
function facets(observations: DemandObservationRow[], analysis: ConversationAnalysisRow | undefined, source: SourceItemRow): Pick<GeoAggregationSignal, "themes" | "pains" | "features" | "competitors" | "intent"> {
  const themes = observations.filter((item) => ["pain", "problem", "capability_request", "desired_outcome"].includes(item.observation_type)).map((item) => item.facet_value);
  const pains = observations.filter((item) => ["pain", "problem"].includes(item.observation_type) || item.facet_key === "pain_theme").map((item) => item.facet_value);
  const features = observations.filter((item) => item.observation_type === "capability_request" || item.facet_key === "capability").map((item) => item.facet_value);
  return { themes: unique(themes), pains: unique(pains), features: unique(features), competitors: competitorValues(source, analysis), intent: observations.find((item) => item.intent_type && item.intent_type !== "unknown")?.intent_type ?? "unknown" };
}
function buildSignals(observations: DemandObservationRow[], conversations: ConversationRow[], sources: SourceItemRow[], analyses: ConversationAnalysisRow[], signals: SignalRow[]): GeoAggregationSignal[] {
  const conversationMap = new Map(conversations.map((row) => [row.id, row]));
  const sourceMap = new Map(sources.map((row) => [row.id, row]));
  const analysisMap = new Map(analyses.map((row) => [row.id, row]));
  const signalMap = new Map(signals.map((row) => [row.conversation_id, row]));
  const grouped = new Map<string, DemandObservationRow[]>();
  for (const observation of observations) grouped.set(observation.conversation_id, [...(grouped.get(observation.conversation_id) ?? []), observation]);
  const results: GeoAggregationSignal[] = [];
  for (const [conversationId, rows] of grouped) {
    const conversation = conversationMap.get(conversationId);
    if (!conversation) continue;
    const source = sourceMap.get(conversation.primary_source_item_id);
    if (!source) continue;
    const analysis = analysisMap.get(rows[0]?.conversation_analysis_id ?? "");
    const location = publicLocation(extractGeoEvidence({ sourceKey: source.source_key, metadata: source.metadata, language: source.language }));
    results.push({ id: signalMap.get(conversationId)?.id ?? conversationId, conversationId, source: source.source_key, observedAt: rows[0]?.observed_at ?? conversation.created_at, publishedAt: source.published_at, location, confidence: rows.reduce((total, row) => total + row.confidence, 0) / Math.max(1, rows.length), excerpt: conversation.body.slice(0, 320), ...facets(rows, analysis, source) });
  }
  return results;
}
function representative(signal: GeoAggregationSignal): GeographySignalSummary { return { id: signal.id, source: signal.source, excerpt: signal.excerpt, intent: signal.intent, theme: signal.themes[0] ?? signal.pains[0] ?? null, confidence: signal.confidence, publishedAt: signal.publishedAt }; }
/** Shared with Layer 9D's current-geography policy: the one definition of "reliable enough to drive a market claim." */
export function reliableLocation(location: GeoPublicLocation): boolean { return (location.confidence === "high" || location.confidence === "medium") && Boolean(location.countryCode); }
export function regionReliableLocation(location: GeoPublicLocation): boolean { return reliableLocation(location) && Boolean(location.regionCode && location.regionName); }
function reliable(signal: GeoAggregationSignal): boolean { return reliableLocation(signal.location); }
function regionReliable(signal: GeoAggregationSignal): boolean { return regionReliableLocation(signal.location); }
function matchesFilters(signal: GeoAggregationSignal, filters: GeographyFilterSelection | undefined): boolean {
  if (!filters) return true;
  return (!filters.theme || signal.themes.includes(filters.theme) || signal.pains.includes(filters.theme) || signal.features.includes(filters.theme)) && (!filters.intent || signal.intent === filters.intent) && (!filters.competitor || signal.competitors.includes(filters.competitor)) && (!filters.source || signal.source === filters.source);
}
function actionFor(market: GeographyMarketSummary): string | null {
  if (!market.availableForDrilldown || market.sampleState === "insufficient_data") return null;
  const place = market.level === "region" ? `${market.marketName}, ${market.countryName}` : market.marketName;
  if (market.topPain && market.trend.direction === "growing") return `${market.topPain} demand is building in ${place}; test positioning that makes this need explicit in the market.`;
  if (market.topFeatureDemand) return `Consider emphasizing ${market.topFeatureDemand} in ${place} content or product messaging.`;
  if (market.topDemandTheme) return `Use ${market.topDemandTheme} as a market-specific positioning hypothesis for ${place}.`;
  return null;
}
function makeMarket(input: { level: "country" | "region"; id: string; marketName: string; countryCode: string; countryName: string; regionCode: string | null; regionName: string | null; current: GeoAggregationSignal[]; previous: GeoAggregationSignal[]; totalGeoQualified: number; parentTotal: number; access: GeographyAccessProjection }): GeographyMarketSummary {
  const market: GeographyMarketSummary = {
    id: input.id, level: input.level, marketName: input.marketName, countryCode: input.countryCode, countryName: input.countryName, regionCode: input.regionCode, regionName: input.regionName, parentCountryCode: input.level === "region" ? input.countryCode : null, parentCountryName: input.level === "region" ? input.countryName : null,
    qualifiedSignalCount: input.current.length, shareOfGeoQualifiedDemand: input.totalGeoQualified ? input.current.length / input.totalGeoQualified : 0, shareOfParentMarket: input.parentTotal ? input.current.length / input.parentTotal : 0,
    trend: trend(input.current.length, input.previous.length, input.access.trendEnabled), sampleState: sampleState(input.current.length), availableForDrilldown: input.level === "country" ? (input.access.regionDrilldown ?? input.access.countryDrilldown) : input.current.length >= 5,
    topDemandTheme: topValue(input.current.flatMap((signal) => signal.themes)), topPain: topValue(input.current.flatMap((signal) => signal.pains)), topIntent: topValue(input.current.map((signal) => signal.intent).filter((value) => value !== "unknown")), topCompetitor: topValue(input.current.flatMap((signal) => signal.competitors)), topSource: topValue(input.current.map((signal) => signal.source)), topFeatureDemand: topValue(input.current.flatMap((signal) => signal.features)), regions: [], representativeSignals: [...input.current].sort((left, right) => right.confidence - left.confidence || right.observedAt.localeCompare(left.observedAt)).slice(0, 5).map(representative), recommendedAction: null,
  };
  market.recommendedAction = actionFor(market);
  return market;
}
function filterOptions(signals: GeoAggregationSignal[]) {
  const values = (read: (signal: GeoAggregationSignal) => string[]) => [...new Set(signals.flatMap(read))].filter(Boolean).sort();
  return { themes: values((signal) => [...signal.themes, ...signal.pains, ...signal.features]), intents: values((signal) => signal.intent === "unknown" ? [] : [signal.intent]), competitors: values((signal) => signal.competitors), sources: values((signal) => [signal.source]) };
}

export function aggregateGeoIntelligence(input: GeoAggregationInput): GeographyReadModel {
  const selection = input.selection ?? {};
  const filters = selection.filters;
  const baseCurrent = input.current.filter((signal) => !selection.countryCode || signal.location.countryCode === selection.countryCode);
  const basePrevious = input.previous.filter((signal) => !selection.countryCode || signal.location.countryCode === selection.countryCode);
  const current = baseCurrent.filter((signal) => matchesFilters(signal, filters));
  const previous = basePrevious.filter((signal) => matchesFilters(signal, filters));
  const currentReliable = current.filter(reliable);
  const previousReliable = previous.filter(reliable);
  const totalGeoQualified = current.filter(reliable).length;
  const requestedCountry = selection.countryCode && currentReliable.some((signal) => signal.location.countryCode === selection.countryCode) ? selection.countryCode : null;
  const countryCurrent = requestedCountry ? currentReliable.filter((signal) => signal.location.countryCode === requestedCountry) : [];
  const countryPrevious = requestedCountry ? previousReliable.filter((signal) => signal.location.countryCode === requestedCountry) : [];
  const countryName = countryCurrent[0]?.location.countryName ?? countryPrevious[0]?.location.countryName ?? requestedCountry ?? "";
  const regionCurrent = countryCurrent.filter(regionReliable);
  const regionPrevious = countryPrevious.filter(regionReliable);
  const regionalQualifiedSignalCount = regionCurrent.length;
  const regionalDataAvailable = Boolean((input.access.regionDrilldown ?? input.access.countryDrilldown) && regionalQualifiedSignalCount >= 5);
  const countryMarket = requestedCountry ? makeMarket({ level: "country", id: requestedCountry, marketName: countryName, countryCode: requestedCountry, countryName, regionCode: null, regionName: null, current: countryCurrent, previous: countryPrevious, totalGeoQualified, parentTotal: totalGeoQualified, access: input.access }) : null;

  const countryCodes = [...new Set(currentReliable.map((signal) => signal.location.countryCode).filter((value): value is string => Boolean(value)))];
  const worldMarkets = countryCodes.map((countryCode) => {
    const rows = currentReliable.filter((signal) => signal.location.countryCode === countryCode);
    const oldRows = previousReliable.filter((signal) => signal.location.countryCode === countryCode);
    const market = makeMarket({ level: "country", id: countryCode, marketName: rows[0]?.location.countryName ?? countryCode, countryCode, countryName: rows[0]?.location.countryName ?? countryCode, regionCode: null, regionName: null, current: rows, previous: oldRows, totalGeoQualified, parentTotal: totalGeoQualified, access: input.access });
    const regionCodes = [...new Set(rows.filter(regionReliable).map((signal) => signal.location.regionCode).filter((value): value is string => Boolean(value)))];
    market.regions = regionCodes.map((regionCode) => ({ regionCode, regionName: rows.find((signal) => signal.location.regionCode === regionCode)?.location.regionName ?? regionCode, qualifiedSignalCount: rows.filter((signal) => signal.location.regionCode === regionCode).length }));
    return market;
  }).sort((left, right) => right.qualifiedSignalCount - left.qualifiedSignalCount || left.marketName.localeCompare(right.marketName));

  const regionCodes = requestedCountry ? [...new Set(regionCurrent.map((signal) => signal.location.regionCode).filter((value): value is string => Boolean(value)))] : [];
  const regionMarkets = regionCodes.map((regionCode) => {
    const rows = regionCurrent.filter((signal) => signal.location.regionCode === regionCode);
    const oldRows = regionPrevious.filter((signal) => signal.location.regionCode === regionCode);
    return makeMarket({ level: "region", id: regionCode, marketName: rows[0]?.location.regionName ?? regionCode, countryCode: requestedCountry!, countryName, regionCode, regionName: rows[0]?.location.regionName ?? regionCode, current: rows, previous: oldRows, totalGeoQualified, parentTotal: countryCurrent.length, access: input.access });
  }).sort((left, right) => right.qualifiedSignalCount - left.qualifiedSignalCount || left.marketName.localeCompare(right.marketName));
  const visibleRegionMarkets = regionalDataAvailable ? regionMarkets : [];
  const requestedRegion = requestedCountry && regionalDataAvailable && (input.access.regionDrilldown ?? input.access.countryDrilldown) && regionMarkets.find((market) => market.id === selection.regionCode && market.availableForDrilldown) ? selection.regionCode ?? null : null;
  const level: GeographyLevel = requestedRegion ? "region" : requestedCountry ? "country" : "world";
  const markets = level === "world" ? worldMarkets : visibleRegionMarkets;
  const selectedMarket = requestedRegion ? regionMarkets.find((market) => market.id === requestedRegion) ?? null : countryMarket;
  const parentMarket = requestedRegion ? countryMarket : null;
  const scopedTotal = level === "world" ? current.length : requestedRegion ? regionMarkets.find((market) => market.id === requestedRegion)?.qualifiedSignalCount ?? 0 : countryCurrent.length;
  const scopedReliable = level === "world" ? totalGeoQualified : requestedRegion ? scopedTotal : countryCurrent.length;
  const unresolvedSubregionSignalCount = requestedCountry ? Math.max(0, countryCurrent.length - regionalQualifiedSignalCount) : 0;
  const coveragePercent = level === "world" ? (current.length ? Math.round((totalGeoQualified / current.length) * 1000) / 10 : 0) : (countryCurrent.length ? Math.round((regionalQualifiedSignalCount / countryCurrent.length) * 1000) / 10 : 0);
  const coverage = level === "world" ? { label: "Reliable country coverage", percent: coveragePercent, numerator: totalGeoQualified, denominator: current.length, description: "High and medium confidence country evidence among qualified demand." } : { label: `Regional coverage in ${countryName}`, percent: coveragePercent, numerator: regionalQualifiedSignalCount, denominator: countryCurrent.length, description: "Share of reliable country demand with a high or medium confidence region." };
  const fastestGrowing = markets.filter((market) => market.trend.hasEnoughHistory).sort((left, right) => (right.trend.percentage ?? -Infinity) - (left.trend.percentage ?? -Infinity) || right.qualifiedSignalCount - left.qualifiedSignalCount).slice(0, 6);
  const breadcrumb: GeographyReadModel["breadcrumb"] = [{ level: "world", label: "World" }];
  if (requestedCountry) breadcrumb.push({ level: "country", label: countryName, countryCode: requestedCountry });
  if (requestedRegion) breadcrumb.push({ level: "region", label: selectedMarket?.marketName ?? requestedRegion, countryCode: requestedCountry!, regionCode: requestedRegion });
  return {
    level, selectedCountryCode: requestedCountry, selectedRegionCode: requestedRegion, breadcrumb, window: input.window, periodEnd: input.periodEnd, periodStart: input.periodStart,
    totalQualifiedSignalCount: scopedTotal, reliableGeoSignalCount: scopedReliable, unknownGeoSignalCount: level === "world" ? current.length - totalGeoQualified : unresolvedSubregionSignalCount, geoCoveragePercent: coverage.percent,
    markets, topMarkets: markets.slice(0, input.access.maxMarkets), fastestGrowing, selectedMarket, parentMarket, regionalDataAvailable, regionalQualifiedSignalCount, regionalCoveragePercent: coveragePercent, coverage, access: input.access, filters: filterOptions(baseCurrent),
  };
}

export class GeographyService {
  constructor(private readonly demand: DemandRepository, private readonly intelligence: IntelligenceRepository) {}

  async getGeography(input: { product: ProductRow; window: GeographyWindow; periodEnd?: string; access: GeographyAccessProjection; selection?: GeographySelection }): Promise<GeographyReadModel> {
    const window = geographyWindowSchema.parse(input.window);
    const periodEnd = input.periodEnd ?? new Date().toISOString();
    const periodStart = windowStart(periodEnd, window);
    const previousStart = new Date(Date.parse(periodStart) - windowLength(window) * 86_400_000).toISOString();
    const currentObservations = await this.demand.listObservations(input.product.workspace_id, input.product.id, periodStart, periodEnd);
    const previousObservations = input.access.trendEnabled ? await this.demand.listObservations(input.product.workspace_id, input.product.id, previousStart, periodStart) : [];
    const observations = [...currentObservations, ...previousObservations];
    const conversationIds = [...new Set(observations.map((row) => row.conversation_id))];
    const conversations = await this.intelligence.listConversations(conversationIds);
    const sourceIds = [...new Set(conversations.map((row) => row.primary_source_item_id))];
    const [sources, analyses, rawSignals] = await Promise.all([this.intelligence.listSourceItems(sourceIds), this.intelligence.listConversationAnalyses([...new Set(observations.map((row) => row.conversation_analysis_id))]), this.intelligence.listSignals(input.product.workspace_id, input.product.id)]);
    // Demand counts come from immutable demand_observations and must not be
    // rewritten by a later dismiss; only the representative-signal id/link
    // attached to a geo point should avoid pointing at a dismissed signal.
    const signals = rawSignals.filter((signal) => signal.lifecycle_status === "active" || signal.lifecycle_status === "saved");
    return aggregateGeoIntelligence({ current: buildSignals(currentObservations, conversations, sources, analyses, signals), previous: buildSignals(previousObservations, conversations, sources, analyses, signals), periodEnd, periodStart, window, access: input.access, selection: input.selection });
  }
}
