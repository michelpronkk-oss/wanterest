import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicIntelligenceDetails } from "../../src/components/share-cards/public-intelligence-details";
import { ShareCardArtwork } from "../../src/components/share-cards/share-card-artwork";
import type { PublicShareCard } from "../../src/server/modules/share-cards/share-card.schemas";

const base: PublicShareCard = {
  publicSlug: "abcdefghijklmnopqrstuvwxyz1234567890ABCD",
  variant: "SIGNAL",
  displayName: "Wanterest intelligence",
  headline: "Evidence-backed finding",
  identityLabel: "Observed signal",
  identityNumber: null,
  tone: "signal",
  isPermanent: false,
  cardKind: "intelligence",
  claimType: "observation",
  claim: "People described a recurring workflow problem.",
  evidence: "A bounded supporting excerpt.",
  interpretation: "This is a product-scoped observation.",
  evidenceStrength: "Qualified match evidence",
  contextLabel: "Current product-scoped observation",
  freshnessLabel: "Observed 2026-09-28",
  observationPeriod: "2026-09-28",
  uncertainty: "Not a market-wide estimate.",
  sourceLabel: "Fixture",
  sourceUrl: "https://example.com/source",
  publishedAt: "2026-09-28T00:00:00.000Z",
  accessMode: "waitlist",
  ctaLabel: "Request access",
  ctaHref: "/waitlist?source=share_card",
  canonicalUrl: "https://www.wanterest.com/share/abcdefghijklmnopqrstuvwxyz1234567890ABCD",
  ogTitle: "Observed signal · Wanterest intelligence",
  ogDescription: "People described a recurring workflow problem.",
};

describe("13B.3 public intelligence presentation", () => {
  it.each([
    ["SIGNAL", "Observation"],
    ["DEMAND_GAP", "Interpretation"],
    ["DEMAND_DRIFT", "Interpretation"],
  ] as const)("renders the %s finding with evidence and uncertainty", (variant, label) => {
    const claimType: PublicShareCard["claimType"] = label === "Observation" ? "observation" : "interpretation";
    const card = { ...base, variant, claimType, claim: `${variant} finding`, interpretation: claimType === "observation" ? "Bounded context" : null };
    const html = renderToStaticMarkup(<PublicIntelligenceDetails card={card} issueHref="mailto:support@wanterest.com" />);
    expect(html).toContain(variant);
    expect(html).toContain(label);
    expect(html).toContain("Supporting evidence");
    expect(html).toContain("What remains uncertain");
    expect(html).not.toContain("market-wide demand");
  });

  it("keeps the same branded renderer contract for public card output", () => {
    const html = renderToStaticMarkup(<ShareCardArtwork data={base} />);
    expect(html).toContain("WANTEREST");
    expect(html).toContain("People described a recurring workflow problem.");
    expect(html).not.toContain("workspace_id");
  });
});
