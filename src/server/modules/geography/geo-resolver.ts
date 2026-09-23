import { geoEvidenceSchema, type GeoEvidence } from "./geo.schemas";

type Place = { countryCode: string; countryName: string; regionCode?: string; regionName?: string; city?: string };

const countries: Record<string, Place> = {
  us: { countryCode: "US", countryName: "United States" }, usa: { countryCode: "US", countryName: "United States" }, "united states": { countryCode: "US", countryName: "United States" }, "united states of america": { countryCode: "US", countryName: "United States" }, america: { countryCode: "US", countryName: "United States" },
  uk: { countryCode: "GB", countryName: "United Kingdom" }, gb: { countryCode: "GB", countryName: "United Kingdom" }, "united kingdom": { countryCode: "GB", countryName: "United Kingdom" },
  ca: { countryCode: "CA", countryName: "Canada" }, canada: { countryCode: "CA", countryName: "Canada" },
  de: { countryCode: "DE", countryName: "Germany" }, germany: { countryCode: "DE", countryName: "Germany" }, deutschland: { countryCode: "DE", countryName: "Germany" },
  nl: { countryCode: "NL", countryName: "Netherlands" }, netherlands: { countryCode: "NL", countryName: "Netherlands" }, holland: { countryCode: "NL", countryName: "Netherlands" },
  fr: { countryCode: "FR", countryName: "France" }, france: { countryCode: "FR", countryName: "France" },
  au: { countryCode: "AU", countryName: "Australia" }, australia: { countryCode: "AU", countryName: "Australia" },
  in: { countryCode: "IN", countryName: "India" }, india: { countryCode: "IN", countryName: "India" },
  ie: { countryCode: "IE", countryName: "Ireland" }, ireland: { countryCode: "IE", countryName: "Ireland" },
  es: { countryCode: "ES", countryName: "Spain" }, spain: { countryCode: "ES", countryName: "Spain" },
  it: { countryCode: "IT", countryName: "Italy" }, italy: { countryCode: "IT", countryName: "Italy" },
  br: { countryCode: "BR", countryName: "Brazil" }, brazil: { countryCode: "BR", countryName: "Brazil" },
  jp: { countryCode: "JP", countryName: "Japan" }, japan: { countryCode: "JP", countryName: "Japan" },
  sg: { countryCode: "SG", countryName: "Singapore" }, singapore: { countryCode: "SG", countryName: "Singapore" },
  se: { countryCode: "SE", countryName: "Sweden" }, sweden: { countryCode: "SE", countryName: "Sweden" },
  ch: { countryCode: "CH", countryName: "Switzerland" }, switzerland: { countryCode: "CH", countryName: "Switzerland" },
};

const regions: Record<string, Place> = {
  california: { countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California" }, "bay area": { countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California" }, "san francisco bay area": { countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California" }, "new york state": { countryCode: "US", countryName: "United States", regionCode: "US-NY", regionName: "New York" }, texas: { countryCode: "US", countryName: "United States", regionCode: "US-TX", regionName: "Texas" }, washington: { countryCode: "US", countryName: "United States", regionCode: "US-WA", regionName: "Washington" }, "new jersey": { countryCode: "US", countryName: "United States", regionCode: "US-NJ", regionName: "New Jersey" }, massachusetts: { countryCode: "US", countryName: "United States", regionCode: "US-MA", regionName: "Massachusetts" }, illinois: { countryCode: "US", countryName: "United States", regionCode: "US-IL", regionName: "Illinois" }, florida: { countryCode: "US", countryName: "United States", regionCode: "US-FL", regionName: "Florida" }, colorado: { countryCode: "US", countryName: "United States", regionCode: "US-CO", regionName: "Colorado" }, georgia: { countryCode: "US", countryName: "United States", regionCode: "US-GA", regionName: "Georgia" },
  ontario: { countryCode: "CA", countryName: "Canada", regionCode: "CA-ON", regionName: "Ontario" }, quebec: { countryCode: "CA", countryName: "Canada", regionCode: "CA-QC", regionName: "Quebec" }, "british columbia": { countryCode: "CA", countryName: "Canada", regionCode: "CA-BC", regionName: "British Columbia" }, alberta: { countryCode: "CA", countryName: "Canada", regionCode: "CA-AB", regionName: "Alberta" }, manitoba: { countryCode: "CA", countryName: "Canada", regionCode: "CA-MB", regionName: "Manitoba" }, saskatchewan: { countryCode: "CA", countryName: "Canada", regionCode: "CA-SK", regionName: "Saskatchewan" },
  bavaria: { countryCode: "DE", countryName: "Germany", regionCode: "DE-BY", regionName: "Bavaria" }, berlin: { countryCode: "DE", countryName: "Germany", regionCode: "DE-BE", regionName: "Berlin" }, "baden wurttemberg": { countryCode: "DE", countryName: "Germany", regionCode: "DE-BW", regionName: "Baden-Württemberg" }, hesse: { countryCode: "DE", countryName: "Germany", regionCode: "DE-HE", regionName: "Hesse" }, hamburg: { countryCode: "DE", countryName: "Germany", regionCode: "DE-HH", regionName: "Hamburg" }, "north rhine westphalia": { countryCode: "DE", countryName: "Germany", regionCode: "DE-NW", regionName: "North Rhine-Westphalia" },
  "noord holland": { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-NH", regionName: "Noord-Holland" }, "north holland": { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-NH", regionName: "Noord-Holland" }, "zuid holland": { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-ZH", regionName: "Zuid-Holland" }, "south holland": { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-ZH", regionName: "Zuid-Holland" }, utrecht: { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-UT", regionName: "Utrecht" }, gelderland: { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-GE", regionName: "Gelderland" },
  england: { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-ENG", regionName: "England" }, scotland: { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-SCT", regionName: "Scotland" }, wales: { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-WLS", regionName: "Wales" }, "northern ireland": { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-NIR", regionName: "Northern Ireland" }, "greater london": { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-LND", regionName: "Greater London" },
  "ile de france": { countryCode: "FR", countryName: "France", regionCode: "FR-IDF", regionName: "Île-de-France" }, "provence alpes cote dazur": { countryCode: "FR", countryName: "France", regionCode: "FR-PAC", regionName: "Provence-Alpes-Côte d’Azur" },
  "new south wales": { countryCode: "AU", countryName: "Australia", regionCode: "AU-NSW", regionName: "New South Wales" }, victoria: { countryCode: "AU", countryName: "Australia", regionCode: "AU-VIC", regionName: "Victoria" }, queensland: { countryCode: "AU", countryName: "Australia", regionCode: "AU-QLD", regionName: "Queensland" }, "western australia": { countryCode: "AU", countryName: "Australia", regionCode: "AU-WA", regionName: "Western Australia" }, "south australia": { countryCode: "AU", countryName: "Australia", regionCode: "AU-SA", regionName: "South Australia" }, tasmania: { countryCode: "AU", countryName: "Australia", regionCode: "AU-TAS", regionName: "Tasmania" },
};

const cities: Record<string, Place> = {
  amsterdam: { countryCode: "NL", countryName: "Netherlands", regionCode: "NL-NH", regionName: "Noord-Holland", city: "Amsterdam" }, berlin: { countryCode: "DE", countryName: "Germany", regionCode: "DE-BE", regionName: "Berlin", city: "Berlin" }, toronto: { countryCode: "CA", countryName: "Canada", regionCode: "CA-ON", regionName: "Ontario", city: "Toronto" }, nyc: { countryCode: "US", countryName: "United States", regionCode: "US-NY", regionName: "New York", city: "New York" }, "new york city": { countryCode: "US", countryName: "United States", regionCode: "US-NY", regionName: "New York", city: "New York" }, "san francisco": { countryCode: "US", countryName: "United States", regionCode: "US-CA", regionName: "California", city: "San Francisco" }, atlanta: { countryCode: "US", countryName: "United States", regionCode: "US-GA", regionName: "Georgia", city: "Atlanta" }, seattle: { countryCode: "US", countryName: "United States", regionCode: "US-WA", regionName: "Washington", city: "Seattle" }, perth: { countryCode: "AU", countryName: "Australia", regionCode: "AU-WA", regionName: "Western Australia", city: "Perth" }, sydney: { countryCode: "AU", countryName: "Australia", regionCode: "AU-NSW", regionName: "New South Wales", city: "Sydney" }, melbourne: { countryCode: "AU", countryName: "Australia", regionCode: "AU-VIC", regionName: "Victoria", city: "Melbourne" }, london: { countryCode: "GB", countryName: "United Kingdom", regionCode: "GB-LND", regionName: "Greater London", city: "London" }, paris: { countryCode: "FR", countryName: "France", regionCode: "FR-IDF", regionName: "Île-de-France", city: "Paris" }, dublin: { countryCode: "IE", countryName: "Ireland", city: "Dublin" }, singapore: { countryCode: "SG", countryName: "Singapore", city: "Singapore" }, tokyo: { countryCode: "JP", countryName: "Japan", city: "Tokyo" }, mumbai: { countryCode: "IN", countryName: "India", city: "Mumbai" }, bengaluru: { countryCode: "IN", countryName: "India", city: "Bengaluru" }, bangalore: { countryCode: "IN", countryName: "India", regionCode: "IN-KA", regionName: "Karnataka", city: "Bengaluru" },
};

const ambiguousStandalone = new Set(["ca", "ga", "wa", "victoria", "georgia", "london", "new jersey"]);
const countryHints: Array<[string, string]> = [["united states", "US"], ["usa", "US"], ["america", "US"], ["canada", "CA"], ["united kingdom", "GB"], ["uk", "GB"], ["germany", "DE"], ["deutschland", "DE"], ["netherlands", "NL"], ["holland", "NL"], ["france", "FR"], ["australia", "AU"], ["india", "IN"]];

function normalized(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function result(place: Place | null, confidence: GeoEvidence["confidence"], evidenceType: GeoEvidence["evidenceType"], rawLocation: string | null): GeoEvidence { return geoEvidenceSchema.parse({ countryCode: place?.countryCode ?? null, countryName: place?.countryName ?? null, regionCode: place?.regionCode ?? null, regionName: place?.regionName ?? null, city: place?.city ?? null, confidence, evidenceType, rawLocation }); }
function tokens(value: string): string[] { return value.split(" ").flatMap((token) => token.split("-")).filter(Boolean); }
function hintCountry(value: string): string | null { return countryHints.find(([hint]) => value.includes(hint))?.[1] ?? null; }
function hasAmbiguousToken(value: string): boolean { return tokens(value).some((token) => ambiguousStandalone.has(token)); }
function regionSuffix(place: Place): string | null { return place.regionCode?.split("-")[1]?.toLowerCase() ?? null; }
function contextAllows(value: string, place: Place): boolean {
  const country = hintCountry(value);
  if (country && country !== place.countryCode) return false;
  if (hasAmbiguousToken(value)) {
    const suffix = regionSuffix(place);
    const aligned = suffix && tokens(value).includes(suffix);
    if (!aligned && !(country && country === place.countryCode)) return false;
  }
  return true;
}
function findCandidate(value: string, source: Record<string, Place>): Place | null { return Object.entries(source).sort(([left], [right]) => right.length - left.length).find(([alias]) => value === alias || value.includes(alias))?.[1] ?? null; }

/** Deterministic, deliberately conservative local resolver. It never calls a geocoding service. */
export function resolveGeoLocation(rawLocation: string | null | undefined): GeoEvidence {
  const raw = typeof rawLocation === "string" ? rawLocation.trim().slice(0, 500) : "";
  if (!raw) return result(null, "unknown", "unknown", null);
  const value = normalized(raw);
  if (!value || ambiguousStandalone.has(value)) return result(null, "unknown", "unknown", raw);
  const canonicalRegion = Object.values(regions).find((place) => place.regionCode?.toLowerCase() === value.replace(/\s+/g, "-").toLowerCase());
  if (canonicalRegion && contextAllows(value, canonicalRegion)) return result(canonicalRegion, "medium", "public_profile_location", raw);
  const city = findCandidate(value, cities);
  if (city && contextAllows(value, city)) return result(city, "medium", "public_profile_location", raw);
  const region = findCandidate(value, regions);
  if (region && contextAllows(value, region)) return result(region, "medium", "public_profile_location", raw);
  const country = countries[value];
  if (country) return result(country, "high", "structured_metadata", raw);
  return result(null, "low", "unknown", raw);
}

export function countryFromCode(countryCode: string | null | undefined): GeoEvidence {
  const key = typeof countryCode === "string" ? countryCode.trim().toLowerCase() : "";
  const place = countries[key];
  return place ? result(place, "high", "provider_country", countryCode?.trim().toUpperCase() ?? null) : result(null, "unknown", "unknown", countryCode ?? null);
}

/** Converts legacy local subdivision codes (for example CA) into ISO 3166-2-style codes. */
export function normalizeGeoEvidence(location: GeoEvidence): GeoEvidence {
  const countryCode = location.countryCode;
  const regionName = normalized(location.regionName ?? "");
  const byName = regionName ? Object.values(regions).find((place) => place.countryCode === countryCode && normalized(place.regionName ?? "") === regionName) : null;
  const byCode = location.regionCode?.includes("-") ? Object.values(regions).find((place) => place.regionCode === location.regionCode) : Object.values(regions).find((place) => place.countryCode === countryCode && place.regionCode?.endsWith(`-${location.regionCode ?? ""}`));
  const place = byName ?? byCode;
  return geoEvidenceSchema.parse({ ...location, regionCode: place?.regionCode ?? (location.regionCode?.includes("-") ? location.regionCode : null), regionName: place?.regionName ?? location.regionName });
}

export function withGeoConfidence(location: GeoEvidence, confidence: GeoEvidence["confidence"], evidenceType: GeoEvidence["evidenceType"]): GeoEvidence { return normalizeGeoEvidence(geoEvidenceSchema.parse({ ...location, confidence, evidenceType })); }
