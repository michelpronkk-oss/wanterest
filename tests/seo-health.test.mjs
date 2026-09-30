import { describe, expect, it } from "vitest";

import { runSeoHealth } from "../scripts/seo-health.mjs";

const routes = ["/", "/product", "/pricing", "/about", "/contact", "/privacy", "/terms", "/cookies"];

function mockFetch({ brokenAppRobots = false } = {}) {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const host = url.hostname;
    const pageHost = host === "www.wanterest.com";
    const appHost = host === "app.wanterest.com";
    const adminHost = host === "admin.wanterest.com";

    if (url.pathname === "/robots.txt") {
      if (pageHost) {
        return new Response([
          "User-Agent: *", "Allow: /", "Disallow: /admin-internal", "Disallow: /app/", "Disallow: /login",
          "Disallow: /signup", "Disallow: /start", "Disallow: /forgot-password", "Disallow: /auth/", "Disallow: /api/",
          "User-Agent: OAI-SearchBot", "Allow: /", "Disallow: /admin-internal", "Disallow: /app/", "Disallow: /login",
          "Disallow: /signup", "Disallow: /start", "Disallow: /forgot-password", "Disallow: /auth/", "Disallow: /api/",
          "Sitemap: https://www.wanterest.com/sitemap.xml",
        ].join("\n"), { headers: { "content-type": "text/plain" } });
      }
      if (appHost) {
        return new Response(`User-Agent: *\n${brokenAppRobots ? "Allow: /" : "Disallow: /"}\n`, {
          headers: { "content-type": "text/plain", "x-robots-tag": "noindex, nofollow, noarchive" },
        });
      }
      if (adminHost) return new Response("User-agent: *\nDisallow: /\n", { headers: { "x-robots-tag": "noindex" } });
    }

    if (url.pathname === "/sitemap.xml") {
      if (pageHost) {
        return new Response(`<urlset>${routes.map((route) => `<url><loc>https://www.wanterest.com${route}</loc></url>`).join("")}</urlset>`);
      }
      return new Response("not found", { status: 404 });
    }

    if (url.pathname === "/admin-internal/operations") {
      return new Response("not found", { status: 404, headers: { "x-robots-tag": "noindex, nofollow, noarchive" } });
    }
    if (adminHost && url.pathname === "/login") return new Response("<h1>Sign in</h1>", { headers: { "x-robots-tag": "noindex, nofollow, noarchive" } });
    if (!pageHost || !routes.includes(url.pathname)) return new Response("not found", { status: 404 });

    const canonical = `https://www.wanterest.com${url.pathname}`;
    const jsonLd = url.pathname === "/" ? '<script type="application/ld+json">{"@context":"https://schema.org"}</script>' : "";
    return new Response(`<!doctype html><html><head><title>Wanterest ${url.pathname}</title><meta name="description" content="Public Wanterest page"><link rel="canonical" href="${canonical}"></head><body><h1>Page heading</h1>${jsonLd}</body></html>`, { headers: { "content-type": "text/html" } });
  };
}

describe("daily public SEO health monitor", () => {
  it("checks the canonical pages, crawler policies, sitemaps, and private host boundaries", async () => {
    const report = await runSeoHealth({ fetchImpl: mockFetch() });
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBeGreaterThan(30);
  });

  it("reports one stable failure when the app host exposes an open robots policy", async () => {
    const report = await runSeoHealth({ fetchImpl: mockFetch({ brokenAppRobots: true }) });
    const failures = report.failures.filter((failure) => failure.id === "robots:app:closed");
    expect(failures).toHaveLength(1);
    expect(report.summary.failed).toBeGreaterThan(0);
  });
});
