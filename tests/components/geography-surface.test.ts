import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Geo Intelligence UI contracts", () => {
  it("adds Geography inside Insights without a sidebar route", () => {
    const tabs = read("src/components/dashboard/insights-tabs.tsx");
    const route = read("src/app/app/(product)/insights/geography/page.tsx");
    expect(tabs).toContain('["Geography", "/app/insights/geography"]');
    expect(route).toContain("getGeographyQuery");
    expect(route).toContain("GeographySurface");
  });

  it("keeps geo interactions keyboard accessible and avoids raw-location UI", () => {
    const surface = read("src/components/dashboard/geography-surface.tsx");
    expect(surface).toContain('role={market ? "button" : undefined}');
    expect(surface).toContain('aria-label={market ? `${shape.label}: ${market.qualifiedSignalCount} qualified signals` : undefined}');
    expect(surface).toContain("onKeyDown");
    expect(surface).not.toContain("rawLocation");
    expect(surface).toContain("Representative demand");
  });

  it("supports shareable hierarchy, lazy geometry, and regional accessibility", () => {
    const surface = read("src/components/dashboard/geography-surface.tsx");
    const loader = read("src/components/dashboard/geo-geometry/loader.ts");
    expect(surface).toContain("useSearchParams");
    expect(surface).toContain("selectedCountryCode");
    expect(surface).toContain("selectedRegionCode");
    expect(surface).toContain("geo-breadcrumb");
    expect(surface).toContain("Regional intelligence is still forming");
    expect(surface).toContain("aria-label={active && market ?");
    expect(surface).toContain("shareOfParentMarket");
    expect(surface).toContain("router.push");
    expect(loader).toContain('import("./regions/us")');
    expect(loader).toContain('import("./regions/ca")');
  });
});
