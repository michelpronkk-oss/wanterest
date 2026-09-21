import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { WebsiteFetchError, WebsiteUnderstandingService, SafeWebsiteFetcher, HtmlWebsitePageExtractor, parsePublicWebsiteUrl, assertPublicHostname } from "../../src/server/providers/website";
import type { ProductRow } from "../../src/server/db/database.helpers";
import { buildDemandProfileV2, classifyProductBusiness, FixtureBusinessClassificationEngine, FixtureDemandProfileEngine, FixtureDemandProfileV2Engine, InMemoryIntelligenceRepository, IntelligenceService, StructuredLlmBusinessClassificationEngine, StructuredLlmDemandProfileV2Engine } from "../../src/server/modules/intelligence";

const product: ProductRow = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  website_url: "https://example.com",
  status: "active",
  current_snapshot_id: null,
  current_demand_profile_id: null,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
};

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function htmlResponse(body: string, headers: Record<string, string> = { "content-type": "text/html" }) {
  return new Response(body, { status: 200, headers });
}

describe("Website Understanding v1", () => {
  it("accepts public HTTP(S) URLs and rejects unsafe URL forms", () => {
    expect(parsePublicWebsiteUrl("http://example.com/path").toString()).toBe("http://example.com/path");
    expect(parsePublicWebsiteUrl("https://www.example.com/#section").toString()).toBe("https://www.example.com/");
    for (const value of ["localhost", "http://example", "http://127.0.0.1", "http://[::1]", "http://192.168.1.10", "ftp://example.com", "file:///etc/passwd", "https://example.com:8443"]) {
      expect(() => parsePublicWebsiteUrl(value)).toThrow(WebsiteFetchError);
    }
  });

  it("rejects private, link-local, and metadata DNS answers", async () => {
    for (const address of ["10.0.0.4", "172.16.0.4", "192.168.1.2", "169.254.169.254", "::1", "fd00::1", "fe80::1"]) {
      await expect(assertPublicHostname("example.com", async () => [{ address }])).rejects.toThrow(WebsiteFetchError);
    }
  });

  it("fetches bounded HTML with a timeout and no automatic external redirect following", async () => {
    const requests: string[] = [];
    const fetcher = new SafeWebsiteFetcher({
      lookupImpl: publicLookup,
      fetchImpl: async (input) => {
        requests.push(String(input));
        return htmlResponse("<html><title>Acme</title><body><h1>Product</h1><p>Useful product content.</p></body></html>");
      },
    });
    const page = await fetcher.fetchPage("https://example.com", { allowedHostname: "example.com" });
    expect(page.status).toBe(200);
    expect(page.contentType).toBe("text/html");
    expect(requests).toEqual(["https://example.com/"]);

    const redirectFetcher = new SafeWebsiteFetcher({
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }),
    });
    await expect(redirectFetcher.fetchPage("https://example.com", { allowedHostname: "example.com" })).rejects.toMatchObject({ kind: "redirect" });
  });

  it("rejects unsupported content and oversized responses", async () => {
    const contentTypeFetcher = new SafeWebsiteFetcher({ lookupImpl: publicLookup, fetchImpl: async () => new Response("binary", { status: 200, headers: { "content-type": "application/pdf" } }) });
    await expect(contentTypeFetcher.fetchPage("https://example.com")).rejects.toMatchObject({ kind: "content_type" });

    const oversized = "x".repeat(32_001);
    const oversizedFetcher = new SafeWebsiteFetcher({ lookupImpl: publicLookup, maxResponseBytes: 32_000, fetchImpl: async () => new Response(oversized, { status: 200, headers: { "content-type": "text/plain", "content-length": String(oversized.length) } }) });
    await expect(oversizedFetcher.fetchPage("https://example.com")).rejects.toMatchObject({ kind: "response_too_large" });
  });

  it("extracts useful text, removes executable/noise blocks, and deduplicates repeated copy", () => {
    const page = new HtmlWebsitePageExtractor().extract({
      url: "https://example.com/",
      status: 200,
      contentType: "text/html",
      text: `<html><head><title>Acme &amp; Teams</title><meta name="description" content="Automate work."></head><body><nav>Login Privacy</nav><main><h1>Automate work</h1><p>Save time for teams.</p><p>Save time for teams.</p><script>alert('ignore')</script><style>.noise{}</style></main><footer>Terms</footer></body></html>`,
    }, "homepage");
    expect(page.title).toBe("Acme & Teams");
    expect(page.metaDescription).toBe("Automate work.");
    expect(page.headings).toEqual(["Automate work"]);
    expect(page.text).toContain("Save time for teams.");
    expect(page.text).not.toContain("alert");
    expect(page.text).not.toContain("Login Privacy");
    expect(page.text.match(/Save time for teams\./g)).toHaveLength(1);
  });

  it("selects at most four high-value same-site pages and ignores legal/auth/external links", async () => {
    const pages: Record<string, string> = {
      "https://example.com/": `<html><body><h1>Acme platform</h1><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/about">About</a><a href="/integrations">Integrations</a><a href="/customers">Customers</a><a href="/login">Login</a><a href="/privacy">Privacy</a><a href="https://other.example/features">External</a></body></html>`,
      "https://example.com/features": "<html><body><h1>Features</h1><p>Automate work.</p></body></html>",
      "https://example.com/pricing": "<html><body><h1>Pricing</h1><p>Simple plans.</p></body></html>",
      "https://example.com/about": "<html><body><h1>About</h1><p>Our team.</p></body></html>",
      "https://example.com/integrations": "<html><body><h1>Integrations</h1><p>Connect tools.</p></body></html>",
      "https://example.com/customers": "<html><body><h1>Customers</h1><p>Customer stories.</p></body></html>",
    };
    const fetcher = { async fetchPage(url: string) { if (url.endsWith("/customers")) throw new WebsiteFetchError("unavailable", "http", 503); return { url, status: 200, contentType: "text/html", text: pages[url] ?? "" }; } };
    const result = await new WebsiteUnderstandingService(fetcher).understand({ websiteUrl: "https://example.com", userDescription: "A platform for busy teams to automate work." });
    expect(result.diagnostics.homepageSucceeded).toBe(true);
    expect(result.diagnostics.selectedPages).toBeLessThanOrEqual(4);
    expect(result.diagnostics.fetchedPages).toBeGreaterThanOrEqual(2);
    expect(result.input.pages.every((page) => new URL(page.url).hostname === "example.com")).toBe(true);
    expect(result.input.combinedText).toContain("Supplemental user description");
    expect(result.provenance.understandingSource).toBe("website_and_description");
  });

  it("falls back to the user description when the homepage cannot be fetched", async () => {
    const result = await new WebsiteUnderstandingService({ async fetchPage() { throw new WebsiteFetchError("timed out", "timeout"); } }).understand({ websiteUrl: "https://example.com", userDescription: "A useful product for operations teams." });
    expect(result.input.pages).toHaveLength(0);
    expect(result.input.combinedText).toBe("A useful product for operations teams.");
    expect(result.provenance.understandingSource).toBe("description_fallback");
    expect(result.provenance.fallbackReason).toBe("timeout");
  });

  it("treats an oversized homepage as a nonfatal description fallback", async () => {
    const result = await new WebsiteUnderstandingService({ async fetchPage() { throw new WebsiteFetchError("too large", "response_too_large"); } }).understand({ websiteUrl: "https://example.com", userDescription: "A useful product for operations teams." });
    expect(result.diagnostics.fallbackUsed).toBe(true);
    expect(result.diagnostics.fallbackReason).toBe("response_too_large");
    expect(result.input.combinedText).toContain("useful product");
  });

  it("completes the snapshot/profile path after an oversized-site fallback with structured LLM output", async () => {
    const website = await new WebsiteUnderstandingService({ async fetchPage() { throw new WebsiteFetchError("too large", "response_too_large"); } }).understand({ websiteUrl: product.website_url ?? "https://example.com", userDescription: "A workflow tool for operations teams that reduces manual reporting." });
    const fixtureClassification = new FixtureBusinessClassificationEngine();
    const fixtureProfile = new FixtureDemandProfileV2Engine();
    const provider = {
      async generateStructured<T>(request: { schemaName: string; userPrompt: string }) {
        const input = { productName: product.name, websiteUrl: product.website_url, snapshotText: website.input.combinedText, sourceReference: product.website_url ?? "product:acme" };
        if (request.schemaName === "BusinessClassificationV1") {
          const result = await fixtureClassification.classify(input);
          return { value: result.output as T, provider: "openai", model: "test-model", promptVersion: request.schemaName };
        }
        const result = await fixtureProfile.generate(input);
        return { value: result.output as T, provider: "openai", model: "test-model", promptVersion: request.schemaName };
      },
    };
    const classification = await classifyProductBusiness(inputForProduct(website), new StructuredLlmBusinessClassificationEngine(provider));
    const profile = await buildDemandProfileV2({ productName: product.name, websiteUrl: product.website_url, sourceReference: product.website_url ?? "product:acme", snapshot: { id: "pending", normalized_text: website.input.combinedText, source_url: product.website_url, metadata: {}, page_type: "manual" }, businessClassification: classification }, new StructuredLlmDemandProfileV2Engine(provider));
    const repository = new InMemoryIntelligenceRepository();
    repository.products.set(product.id, product);
    const service = new IntelligenceService(repository);
    const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: website.input.combinedText, sourceUrl: product.website_url, metadata: { website_understanding: website.provenance }, businessClassification: classification, demandProfileV2: profile });
    const legacyProfile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, "88888888-8888-4888-8888-888888888888", new FixtureDemandProfileEngine());
    const persistedProduct = repository.products.get(product.id);
    expect(website.diagnostics.fallbackReason).toBe("response_too_large");
    expect(snapshot.metadata).toMatchObject({ business_classification: { provider: "openai" }, demand_profile_v2: { provider: "openai" } });
    expect(profile.problems.length + profile.desired_outcomes.length + profile.jobs_to_be_done.length).toBeGreaterThan(0);
    expect(persistedProduct?.current_snapshot_id).toBe(snapshot.id);
    expect(persistedProduct?.current_demand_profile_id).toBe(legacyProfile.id);
    expect((await repository.getDemandProfiles(product.id)).find((row) => row.id === legacyProfile.id)?.id).toBe(legacyProfile.id);
  });

  it("feeds the website context through the existing classification/profile snapshot path", async () => {
    const website = await new WebsiteUnderstandingService({
      async fetchPage(url: string) {
        return { url, status: 200, contentType: "text/html", text: "<html><body><main><h1>Workflow automation for teams</h1><p>Automate manual reporting and save time for operations teams.</p></main></body></html>" };
      },
    }).understand({ websiteUrl: "https://example.com", userDescription: "A workflow tool for operations teams." });
    const classification = await classifyProductBusiness({ productName: product.name, websiteUrl: product.website_url, snapshotText: website.input.combinedText, sourceReference: product.website_url ?? "product:acme" }, new FixtureBusinessClassificationEngine());
    const profile = await buildDemandProfileV2({ productName: product.name, websiteUrl: product.website_url, sourceReference: product.website_url ?? "product:acme", snapshot: { id: "pending", normalized_text: website.input.combinedText, source_url: product.website_url, metadata: {}, page_type: "homepage" }, businessClassification: classification }, new FixtureDemandProfileV2Engine());
    const repository = new InMemoryIntelligenceRepository();
    repository.products.set(product.id, product);
    const snapshot = await new IntelligenceService(repository).createSnapshot(product, { pageType: "homepage", rawText: website.input.combinedText, sourceUrl: product.website_url, metadata: { website_understanding: website.provenance }, businessClassification: classification, demandProfileV2: profile });
    expect(snapshot.metadata).toMatchObject({ website_understanding: { websiteFetchSucceeded: true, pagesFetched: [{ url: "https://example.com/" }] }, business_classification: { provider: "fixture" }, demand_profile_v2: { version: "demand_profile_v2" } });
    expect(snapshot.page_type).toBe("homepage");
    expect(snapshot.normalized_text).toContain("Workflow automation for teams");
  });
});

function inputForProduct(website: Awaited<ReturnType<WebsiteUnderstandingService["understand"]>>) {
  return { productName: product.name, websiteUrl: product.website_url, snapshotText: website.input.combinedText, sourceReference: product.website_url ?? "product:acme" };
}
