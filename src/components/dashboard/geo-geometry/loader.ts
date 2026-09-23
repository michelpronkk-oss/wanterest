import type { RegionGeometry } from "./types";

/** Loads only the selected country's small display geometry chunk. */
export async function loadRegionGeometry(countryCode: string): Promise<RegionGeometry | null> {
  switch (countryCode) {
    case "US": return (await import("./regions/us")).geometry;
    case "CA": return (await import("./regions/ca")).geometry;
    case "DE": return (await import("./regions/de")).geometry;
    case "NL": return (await import("./regions/nl")).geometry;
    case "AU": return (await import("./regions/au")).geometry;
    case "GB": return (await import("./regions/gb")).geometry;
    case "FR": return (await import("./regions/fr")).geometry;
    default: return null;
  }
}
