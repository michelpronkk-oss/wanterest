import { describe, expect, it } from "vitest";

import { isKnownShareCrawler } from "../../src/server/modules/share-cards/share-card.analytics";
import { publicShareCardSchema, shareCardSnapshotSchema, shareCardVariantSchema } from "../../src/server/modules/share-cards/share-card.schemas";

describe("Layer 13B.2 intelligence share-card contracts", () => {
  it("keeps intelligence variants explicit and bounded", () => {
    expect(shareCardVariantSchema.parse("SIGNAL")).toBe("SIGNAL");
    expect(shareCardVariantSchema.parse("DEMAND_GAP")).toBe("DEMAND_GAP");
    expect(shareCardVariantSchema.parse("DEMAND_DRIFT")).toBe("DEMAND_DRIFT");
    expect(() => shareCardVariantSchema.parse("GEOGRAPHY")).toThrow();
  });

  it("accepts evidence-backed snapshot fields without allowing private IDs", () => {
    const snapshot = shareCardSnapshotSchema.parse({
      displayName: "Wanterest intelligence",
      headline: "A current observation",
      identityLabel: "Observed signal",
      identityNumber: null,
      tone: "signal",
      isPermanent: false,
      cardKind: "intelligence",
      claimType: "observation",
      claim: "A conversation described a recurring need.",
      evidence: "The supporting excerpt is available.",
      interpretation: "This is the bounded Wanterest interpretation.",
      evidenceStrength: "Qualified match evidence",
      contextLabel: "Product-scoped observation",
      freshnessLabel: "Observed 2026-09-28",
      observationPeriod: "2026-09-28",
      uncertainty: "Not a market-wide estimate.",
      sourceLabel: "Fixture",
      sourceUrl: "https://example.com/source",
    });
    expect(snapshot).not.toHaveProperty("workspaceId");
    expect(snapshot).not.toHaveProperty("sourceId");
    expect(publicShareCardSchema.shape).not.toHaveProperty("sourceId");
  });

  it("does not count known social crawlers as human distribution activity", () => {
    expect(isKnownShareCrawler("Twitterbot/1.0")).toBe(true);
    expect(isKnownShareCrawler("LinkedInBot/1.0")).toBe(true);
    expect(isKnownShareCrawler("Mozilla/5.0 human browser")).toBe(false);
    expect(isKnownShareCrawler(null)).toBe(false);
  });
});
