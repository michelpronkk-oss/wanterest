import { describe, expect, it } from "vitest";

import { getOnboardingSuccessPath, ONBOARDING_SCAN_PATH, onboardingSuccessState } from "../../src/lib/onboarding-transition";
import { findExistingOnboardingProduct, hasCompletedOnboardingUnderstanding, needsOnboardingUnderstanding } from "../../src/server/modules/onboarding/onboarding-product-flow";
import { deriveOnboardingProductName, normalizeOnboardingWebsiteUrl, onboardingProductInputSchema, slugifyOnboardingName } from "../../src/server/modules/onboarding/onboarding.schemas";
import { productDatabaseError } from "../../src/server/modules/products/product-errors";
import { workspaceIdSchema } from "../../src/server/modules/products/product.schemas";
import { getEntryDestination } from "../../src/shared/config/entry-flow";
import { safeInternalPath, startPathForWebsite } from "../../src/shared/config/site";
import { normalizePublicWebsiteUrl } from "../../src/shared/validation/public-website";

describe("onboarding input boundaries", () => {
  it("normalizes bare public domains to https URLs", () => {
    expect(normalizeOnboardingWebsiteUrl("  example.com/product  ")).toBe("https://example.com");
    expect(normalizeOnboardingWebsiteUrl("http://example.com")).toBe("https://example.com");
    expect(normalizeOnboardingWebsiteUrl("HTTPS://WWW.Example.COM/")).toBe("https://www.example.com");
  });

  it("rejects non-http(s), weak hosts, raw IPs, and private destinations", () => {
    expect(() => normalizeOnboardingWebsiteUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("ftp://example.com")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("example")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("example .com")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://localhost:3000")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://192.168.1.10")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("https://8.8.8.8")).toThrow();
    expect(() => normalizeOnboardingWebsiteUrl("http://[::1]")).toThrow();
  });

  it("derives product names from the registrable domain", () => {
    expect(deriveOnboardingProductName("acme.com")).toBe("Acme");
    expect(deriveOnboardingProductName("app.linear.app")).toBe("Linear");
    expect(deriveOnboardingProductName("docs.example.com")).toBe("Example");
  });

  it("requires a useful one-line product description", () => {
    const base = { name: "Acme", websiteUrl: "https://acme.com" };
    expect(onboardingProductInputSchema.safeParse({ ...base, description: "Too short" }).success).toBe(false);
    expect(onboardingProductInputSchema.safeParse({ ...base, description: "A product description that is long enough." }).success).toBe(true);
    expect(onboardingProductInputSchema.safeParse({ ...base, description: "x".repeat(241) }).success).toBe(false);
  });

  it("derives a stable database-safe workspace slug", () => {
    expect(slugifyOnboardingName("Miche & Co. Research")).toBe("miche-co-research");
    expect(slugifyOnboardingName("!!!")).toBe("workspace");
  });

  it("returns an explicit Step 3 transition for a completed product setup", () => {
    const success = onboardingSuccessState("product-123");
    expect(success).toEqual({
      status: "success",
      error: null,
      productId: "product-123",
      nextPath: ONBOARDING_SCAN_PATH,
    });
    expect(getOnboardingSuccessPath(success)).toBe(ONBOARDING_SCAN_PATH);
    expect(getOnboardingSuccessPath({ status: "error", nextPath: ONBOARDING_SCAN_PATH })).toBeNull();
  });

  it("does not create an implicit dashboard transition from the scan success path", () => {
    expect(ONBOARDING_SCAN_PATH).toBe("/app/setup/scan");
    expect(getOnboardingSuccessPath(onboardingSuccessState("product-123"))).not.toBe("/app");
  });

  it("resumes an existing incomplete product instead of creating a duplicate", () => {
    const product = {
      id: "product-1",
      slug: "inovense-agency",
      website_url: "https://inovense.agency",
      status: "active" as const,
      current_snapshot_id: null,
      current_demand_profile_id: null,
    };
    expect(findExistingOnboardingProduct([product], { slug: product.slug, websiteUrl: product.website_url })).toBe(product);
    expect(needsOnboardingUnderstanding(product)).toBe(true);
    expect(hasCompletedOnboardingUnderstanding(product)).toBe(false);
  });

  it("recognizes a complete product and leaves a different domain available", () => {
    const existing = {
      id: "product-1",
      slug: "inovense-agency",
      website_url: "https://inovense.agency",
      status: "active" as const,
      current_snapshot_id: "snapshot-1",
      current_demand_profile_id: "profile-1",
    };
    expect(hasCompletedOnboardingUnderstanding(existing)).toBe(true);
    expect(findExistingOnboardingProduct([], { slug: "inovense-agency", websiteUrl: "https://inovense.agency" })).toBeUndefined();
    expect(findExistingOnboardingProduct([existing], { slug: "other-product", websiteUrl: "https://other-product.com" })).toBeUndefined();
  });

  it("does not treat an archived product as a resumable active product", () => {
    const archived = {
      id: "product-1",
      slug: "inovense-agency",
      website_url: "https://inovense.agency",
      status: "archived" as const,
      current_snapshot_id: null,
      current_demand_profile_id: null,
    };
    const match = findExistingOnboardingProduct([archived], { slug: archived.slug, websiteUrl: archived.website_url });
    expect(match?.status).toBe("archived");
    expect(needsOnboardingUnderstanding(archived)).toBe(true);
  });

  it("maps product RPC errors without exposing provider details", () => {
    expect(productDatabaseError({ code: "23505", message: "product_slug_already_exists" }, "fallback").code).toBe("CONFLICT");
    expect(productDatabaseError({ code: "P0001", message: "products_capability_missing" }, "fallback").code).toBe("CAPABILITY_DISABLED");
    expect(productDatabaseError({ code: "42501", message: "workspace_access_denied" }, "fallback").code).toBe("FORBIDDEN");
    const unknown = productDatabaseError({ code: "23502", message: "null value violates not-null constraint", details: 'Failing row contains ... constraint "products_name_not_null"' }, "fallback");
    expect(unknown.message).toBe("fallback");
    expect(unknown.details).toMatchObject({ providerCode: "23502", providerConstraint: "products_name_not_null" });
  });

  it("requires a real workspace UUID before product persistence", () => {
    expect(workspaceIdSchema.safeParse("not-a-workspace").success).toBe(false);
    expect(workspaceIdSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
  });

  it("preserves a normalized website through the start funnel", () => {
    const website = normalizePublicWebsiteUrl("linear.app");
    expect(startPathForWebsite(website)).toBe("/start?website=https%3A%2F%2Flinear.app");
    expect(getEntryDestination({ authenticated: false, hasWorkspace: false, hasProduct: false, productUnderstandingReady: false, scanState: null }, website)).toBe("/signup?website=https%3A%2F%2Flinear.app");
    expect(getEntryDestination({ authenticated: true, hasWorkspace: false, hasProduct: false, productUnderstandingReady: false, scanState: null }, website)).toBe("/app/setup/workspace?website=https%3A%2F%2Flinear.app");
    expect(getEntryDestination({ authenticated: true, hasWorkspace: true, hasProduct: false, productUnderstandingReady: false, scanState: null }, website)).toBe("/app/setup/product?website=https%3A%2F%2Flinear.app");
  });

  it("resumes the furthest persisted onboarding state without overwriting an existing product", () => {
    expect(getEntryDestination({ authenticated: true, hasWorkspace: true, hasProduct: true, productUnderstandingReady: false, scanState: null }, "https://other.example")).toBe("/app/setup/product");
    expect(getEntryDestination({ authenticated: true, hasWorkspace: true, hasProduct: true, productUnderstandingReady: true, scanState: "no_scan" })).toBe("/app/setup/scan");
    expect(getEntryDestination({ authenticated: true, hasWorkspace: true, hasProduct: true, productUnderstandingReady: true, scanState: "completed_with_signals" })).toBe("/app");
  });

  it("rejects unsafe callback destinations", () => {
    expect(safeInternalPath("https://evil.example")).toBe("/start");
    expect(safeInternalPath("//evil.example")).toBe("/start");
    expect(safeInternalPath("/app/setup/product")).toBe("/app/setup/product");
  });
});
