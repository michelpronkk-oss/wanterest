#!/usr/bin/env node

const PUBLIC_ROUTES = ["/", "/product", "/pricing", "/about", "/contact", "/privacy", "/terms", "/cookies"];
const PRIVATE_ROUTE_DISALLOWS = ["/admin-internal", "/app/", "/login", "/signup", "/start", "/forgot-password", "/auth/", "/api/"];
const CANONICAL_HOST = "www.wanterest.com";
const APP_HOST = "app.wanterest.com";
const ADMIN_HOST = "admin.wanterest.com";
const currentModuleUrl = import.meta.url;

function normalizedOrigin(value, label, { allowLocal = false } = {}) {
  const parsed = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowLocal && local && parsed.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (!local && parsed.hostname !== label) throw new Error(`${label} must use the expected production hostname.`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error(`${label} must be an origin without credentials, path, query, or fragment.`);
  }
  return parsed.origin;
}

function getAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function hasNoindex(value) {
  return /\bnoindex\b/i.test(value ?? "");
}

export async function runSeoHealth({
  marketingOrigin = process.env.SEO_MARKETING_ORIGIN ?? "https://www.wanterest.com",
  appOrigin = process.env.SEO_APP_ORIGIN ?? "https://app.wanterest.com",
  adminOrigin = process.env.SEO_ADMIN_ORIGIN ?? "https://admin.wanterest.com",
  allowLocal = process.env.SEO_HEALTH_ALLOW_LOCAL === "1",
  fetchImpl = fetch,
} = {}) {
  const origins = {
    marketing: normalizedOrigin(marketingOrigin, CANONICAL_HOST, { allowLocal }),
    app: normalizedOrigin(appOrigin, APP_HOST, { allowLocal }),
    admin: normalizedOrigin(adminOrigin, ADMIN_HOST, { allowLocal }),
  };
  const checks = [];
  const recorded = new Set();
  const record = (id, passed, detail) => {
    if (recorded.has(id)) return;
    recorded.add(id);
    checks.push({ id, passed, ...(passed ? {} : { detail }) });
  };

  async function get(url) {
    try {
      return await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    } catch {
      return null;
    }
  }

  const expectedPublicUrls = PUBLIC_ROUTES.map((route) => `${origins.marketing}${route}`);
  for (const route of PUBLIC_ROUTES) {
    const id = route === "/" ? "home" : route.slice(1);
    const expectedUrl = `${origins.marketing}${route}`;
    const response = await get(expectedUrl);
    if (!response) {
      record(`page:${id}:fetch`, false, "The public route did not return a response.");
      continue;
    }

    record(`page:${id}:status`, response.status === 200, `Expected HTTP 200; received ${response.status}.`);
    const finalUrl = response.url || expectedUrl;
    record(`page:${id}:host`, new URL(finalUrl).host === new URL(origins.marketing).host, "The route did not remain on the canonical marketing host.");

    const html = await response.text();
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const descriptionTag = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i)?.[0];
    const description = descriptionTag ? getAttribute(descriptionTag, "content") : null;
    const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).find((tag) => /\brel=["']canonical["']/i.test(tag));
    const canonical = canonicalTag ? getAttribute(canonicalTag, "href") : null;

    record(`page:${id}:title`, Boolean(title), "A server-rendered title is missing.");
    record(`page:${id}:description`, Boolean(description), "A server-rendered meta description is missing.");
    record(`page:${id}:canonical`, canonical === expectedUrl, "The canonical URL does not match the route on the canonical marketing host.");
    record(`page:${id}:h1`, (html.match(/<h1\b/gi) ?? []).length === 1, "Expected exactly one server-rendered H1.");

    if (route === "/") {
      const jsonLdScripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      let validJsonLd = jsonLdScripts.length > 0;
      for (const script of jsonLdScripts) {
        try {
          JSON.parse(script[1]);
        } catch {
          validJsonLd = false;
        }
      }
      record("structured-data:home", validJsonLd, "Homepage JSON-LD is missing or invalid JSON.");
      record("page:home:indexable", !hasNoindex(response.headers.get("x-robots-tag")), "The canonical homepage response has an unexpected noindex header.");
    }
  }

  const sitemapResponse = await get(`${origins.marketing}/sitemap.xml`);
  if (!sitemapResponse) {
    record("sitemap:marketing:fetch", false, "The canonical sitemap did not return a response.");
  } else {
    record("sitemap:marketing:status", sitemapResponse.status === 200, `Expected HTTP 200; received ${sitemapResponse.status}.`);
    const sitemapText = await sitemapResponse.text();
    const sitemapUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
    record("sitemap:marketing:membership", JSON.stringify(sitemapUrls) === JSON.stringify(expectedPublicUrls), "The canonical sitemap does not contain exactly the eight approved public routes in order.");
  }

  const marketingRobots = await get(`${origins.marketing}/robots.txt`);
  if (!marketingRobots) {
    record("robots:marketing:fetch", false, "The canonical robots file did not return a response.");
  } else {
    record("robots:marketing:status", marketingRobots.status === 200, `Expected HTTP 200; received ${marketingRobots.status}.`);
    const content = await marketingRobots.text();
    const privateRulesPresent = PRIVATE_ROUTE_DISALLOWS.every((path) => content.includes(`Disallow: ${path}`));
    record("robots:marketing:private-paths", privateRulesPresent, "One or more private path disallows are missing.");
    record("robots:marketing:oai-search", /User-Agent:\s*OAI-SearchBot/i.test(content) && /Sitemap:\s*https:\/\/www\.wanterest\.com\/sitemap\.xml/i.test(content), "The OAI Search group or canonical sitemap directive is missing.");
    record("robots:marketing:gpt-policy", !/User-Agent:\s*GPTBot/i.test(content), "A GPTBot-specific policy appeared without a reviewed training-policy change.");
  }

  for (const [surface, origin] of [["app", origins.app], ["admin", origins.admin]]) {
    const robots = await get(`${origin}/robots.txt`);
    if (!robots) {
      record(`robots:${surface}:fetch`, false, "The host-specific robots file did not return a response.");
      continue;
    }
    record(`robots:${surface}:status`, robots.status === 200, `Expected HTTP 200; received ${robots.status}.`);
    const policy = await robots.text();
    record(`robots:${surface}:closed`, /User-Agent:\s*\*/i.test(policy) && /Disallow:\s*\//i.test(policy), "The non-marketing hostname is not disallowed from crawling.");
    record(`robots:${surface}:noindex`, hasNoindex(robots.headers.get("x-robots-tag")), "The robots response lacks a noindex response header.");

    const sitemap = await get(`${origin}/sitemap.xml`);
    if (!sitemap) {
      record(`sitemap:${surface}:fetch`, false, "The non-marketing sitemap path did not return a response.");
    } else {
      const text = await sitemap.text();
      record(`sitemap:${surface}:empty`, sitemap.status === 404 || !/<loc>/i.test(text), "A non-marketing hostname exposes public sitemap URLs.");
    }

    const privateResponse = await get(`${origin}/admin-internal/operations`);
    record(`host-isolation:${surface}:private-route`, privateResponse?.status === 404, "The private Admin namespace did not return not-found on a non-Admin hostname.");
    record(`host-isolation:${surface}:private-noindex`, hasNoindex(privateResponse?.headers.get("x-robots-tag")), "The private-route response lacks a noindex header.");
  }

  const adminLogin = await get(`${origins.admin}/login`);
  record("admin:login:noindex", Boolean(adminLogin && adminLogin.status === 200 && hasNoindex(adminLogin.headers.get("x-robots-tag"))), "The Admin login is unavailable or missing its noindex response header.");

  const privateOnMarketing = await get(`${origins.marketing}/admin-internal/operations`);
  record("host-isolation:marketing:private-route", privateOnMarketing?.status === 404, "The private Admin namespace did not return not-found on the marketing hostname.");
  record("host-isolation:marketing:private-noindex", hasNoindex(privateOnMarketing?.headers.get("x-robots-tag")), "The private-route response lacks a noindex header.");

  const failures = checks.filter((check) => !check.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    summary: { passed: checks.length - failures.length, failed: failures.length },
    failures,
  };
  if (process.env.SEO_HEALTH_REPORT_PATH) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.SEO_HEALTH_REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

if (process.argv[1] && currentModuleUrl === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runSeoHealth();
    console.log(`SEO technical health: ${report.summary.passed} passed, ${report.summary.failed} failed.`);
    if (report.failures.length) {
      console.error(`Failing check IDs: ${report.failures.map((failure) => failure.id).join(", ")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "SEO health check could not start.");
    process.exitCode = 1;
  }
}
