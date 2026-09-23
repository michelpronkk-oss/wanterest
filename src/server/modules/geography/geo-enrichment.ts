import { jsonObjectSchema, type JsonObject } from "../../db/database.helpers";
import { geoEvidenceSchema, type GeoEvidence } from "./geo.schemas";
import { countryFromCode, normalizeGeoEvidence, resolveGeoLocation, withGeoConfidence } from "./geo-resolver";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return typeof value === "string" ? value.trim().slice(0, 500) : null;
}

function existingGeo(metadata: JsonObject): GeoEvidence | null {
  const parsed = geoEvidenceSchema.safeParse(metadata.geo);
  return parsed.success ? normalizeGeoEvidence(parsed.data) : null;
}

/** Reads only explicit provider/profile fields. Hosting country and language are never treated as country evidence. */
export function extractGeoEvidence(input: { sourceKey: string; metadata?: unknown; language?: string | null }): GeoEvidence {
  const metadata = record(input.metadata);
  const saved = existingGeo(jsonObjectSchema.parse(metadata));
  if (saved) return saved;

  const nested = [record(metadata.profile), record(metadata.author), record(metadata.user), record(metadata.reviewer), record(metadata.consumer)];
  const countryCode = text(
    metadata.countryCode, metadata.country_code, metadata.providerCountryCode, metadata.authorCountryCode,
    ...nested.flatMap((value) => [value.countryCode, value.country_code]),
  );
  if (countryCode) {
    const country = countryFromCode(countryCode);
    if (country.countryCode) return withGeoConfidence(country, "high", input.sourceKey === "g2" || input.sourceKey === "trustpilot" ? "review_region" : "provider_country");
  }

  const countryName = text(metadata.countryName, metadata.country, metadata.providerCountry, metadata.authorCountry, ...nested.flatMap((value) => [value.countryName, value.country]));
  if (countryName) {
    const country = resolveGeoLocation(countryName);
    if (country.countryCode) return withGeoConfidence(country, "high", input.sourceKey === "g2" || input.sourceKey === "trustpilot" ? "review_region" : "structured_metadata");
  }

  const rawLocation = text(
    metadata.location, metadata.authorLocation, metadata.profileLocation, metadata.userLocation, metadata.reviewerLocation,
    metadata.reviewRegion, metadata.region, metadata.city,
    ...nested.flatMap((value) => [value.location, value.profileLocation, value.userLocation, value.city]),
  );
  if (rawLocation) return resolveGeoLocation(rawLocation);

  if (typeof input.language === "string" && input.language.trim()) {
    return geoEvidenceSchema.parse({ countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "low", evidenceType: "language_only", rawLocation: null });
  }
  return geoEvidenceSchema.parse({ countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "unknown", evidenceType: "unknown", rawLocation: null });
}

export function enrichSourceMetadata(metadata: JsonObject, input: { sourceKey: string; language?: string | null }): JsonObject {
  const geo = extractGeoEvidence({ sourceKey: input.sourceKey, metadata, language: input.language });
  return jsonObjectSchema.parse({ ...metadata, geo });
}

export function publicGeoEvidence(value: unknown) {
  const parsed = geoEvidenceSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    countryCode: parsed.data.countryCode,
    countryName: parsed.data.countryName,
    regionCode: parsed.data.regionCode,
    regionName: parsed.data.regionName,
    city: parsed.data.city,
    confidence: parsed.data.confidence,
    evidenceType: parsed.data.evidenceType,
  };
}
