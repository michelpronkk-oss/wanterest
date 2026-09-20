import { describe, expect, it } from "vitest";

import { normalizeOnboardingWebsiteUrl, slugifyOnboardingName } from "../../src/server/modules/onboarding/onboarding.schemas";

describe("onboarding input boundaries", () => {
  it("normalizes bare public domains to https URLs", () => {
    expect(normalizeOnboardingWebsiteUrl("  example.com/product  ")).toBe("https://example.com/product");
    expect(normalizeOnboardingWebsiteUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects non-http(s) and private destinations", () => {
    expect(() => normalizeOnboardingWebsiteUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://localhost:3000")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://192.168.1.10")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://[::1]")).toThrow();
  });

  it("derives a stable database-safe workspace slug", () => {
    expect(slugifyOnboardingName("Miche & Co. Research")).toBe("miche-co-research");
    expect(slugifyOnboardingName("!!!")).toBe("workspace");
  });
});
