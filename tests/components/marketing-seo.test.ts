import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "../../src/components/marketing/structured-data";
import { SITE_ORIGIN, SUPPORT_EMAIL, X_PROFILE_URL } from "../../src/shared/config/site";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const MARKETING_PAGES = [
  { path: "src/app/product/page.tsx", canonical: "/product", title: "Wanterest Product — Turn Real Demand Into Intelligence" },
  { path: "src/app/pricing/page.tsx", canonical: "/pricing", title: "Wanterest Pricing — Free, Pro & Growth Plans" },
  { path: "src/app/about/page.tsx", canonical: "/about", title: "About Wanterest — Built Around Real Market Demand" },
  { path: "src/app/contact/page.tsx", canonical: "/contact", title: "Contact Wanterest" },
  { path: "src/app/privacy/page.tsx", canonical: "/privacy", title: "Privacy Policy — Wanterest" },
  { path: "src/app/terms/page.tsx", canonical: "/terms", title: "Terms of Service — Wanterest" },
  { path: "src/app/cookies/page.tsx", canonical: "/cookies", title: "Cookie Policy — Wanterest" },
];

const NOINDEX_AUTH_FILES = [
  "src/app/login/page.tsx",
  "src/app/signup/page.tsx",
  "src/app/start/page.tsx",
  "src/app/forgot-password/page.tsx",
  "src/app/forgot-password/update/page.tsx",
  "src/app/app/layout.tsx",
];

describe("sitemap.xml", () => {
  it("includes only indexable public marketing routes", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      SITE_ORIGIN,
      `${SITE_ORIGIN}/product`,
      `${SITE_ORIGIN}/pricing`,
      `${SITE_ORIGIN}/about`,
      `${SITE_ORIGIN}/contact`,
      `${SITE_ORIGIN}/privacy`,
      `${SITE_ORIGIN}/terms`,
      `${SITE_ORIGIN}/cookies`,
    ]);
  });

  it("never includes app, auth, or API routes", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const url of urls) {
      expect(url).not.toMatch(/\/app\/|\/login|\/signup|\/start|\/api\/|\/auth\//);
    }
  });

  it("only assigns lastModified where a real, meaningful date is shown on the page", () => {
    const entries = sitemap();
    const withDate = entries.filter((entry) => entry.lastModified !== undefined);
    expect(withDate.map((entry) => entry.url)).toEqual([
      `${SITE_ORIGIN}/privacy`,
      `${SITE_ORIGIN}/terms`,
      `${SITE_ORIGIN}/cookies`,
    ]);
  });
});

describe("robots.txt", () => {
  it("allows public crawling and references the sitemap on the canonical marketing host", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.allow).toBe("/");
    expect(rules?.disallow).toEqual(expect.arrayContaining(["/app/", "/login", "/signup", "/start", "/forgot-password", "/auth/", "/api/"]));
    expect(result.sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
    expect(result.host).toBe(SITE_ORIGIN);
  });

  it("does not disallow the homepage or any indexable marketing page", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = Array.isArray(rules?.disallow) ? rules.disallow : [rules?.disallow].filter(Boolean);
    for (const path of ["/", "/product", "/pricing", "/about", "/contact", "/privacy", "/terms", "/cookies"]) {
      expect(disallow.some((rule) => rule && path.startsWith(rule as string) && rule !== "/")).toBe(false);
    }
  });
});

describe("structured data", () => {
  it("produces valid, parseable JSON-LD with no fabricated rating/review/company facts", () => {
    for (const data of [organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd()]) {
      const parsed = JSON.parse(JSON.stringify(data));
      expect(parsed["@context"]).toBe("https://schema.org");
      const serialized = JSON.stringify(parsed);
      for (const forbidden of ["aggregateRating", "review", "customerCount", "award", "foundingDate", "employeeCount", "address"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it("only links a real, confirmed social profile via sameAs", () => {
    const org = organizationJsonLd() as { sameAs: string[] };
    expect(org.sameAs).toEqual([X_PROFILE_URL]);
    expect(X_PROFILE_URL).toBe("https://x.com/wanterestHQ");
  });

  it("represents real public pricing accurately in SoftwareApplication offers", () => {
    const app = softwareApplicationJsonLd() as { offers: Array<{ name: string; price: string }> };
    expect(app.offers).toEqual([
      { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro", price: "49", priceCurrency: "USD" },
      { "@type": "Offer", name: "Growth", price: "99", priceCurrency: "USD" },
    ]);
  });
});

describe("marketing page metadata", () => {
  it("gives every indexable marketing page a matching absolute title and self-referencing canonical", () => {
    for (const page of MARKETING_PAGES) {
      const source = read(page.path);
      expect(source).toContain(`title: { absolute: TITLE }`);
      expect(source).toContain(`const TITLE = "${page.title}";`);
      expect(source).toContain(`alternates: { canonical: "${page.canonical}" }`);
      expect(source).toContain(`openGraph: { title: TITLE, description: DESCRIPTION, url: "${page.canonical}" }`);
    }
  });

  it("gives the homepage a custom absolute title and root canonical", () => {
    const source = read("src/app/page.tsx");
    expect(source).toContain("title: { absolute: DEFAULT_TITLE }");
    expect(source).toContain('alternates: { canonical: "/" }');
  });
});

describe("private/auth surface noindex", () => {
  it("keeps every app/auth utility route out of search indexes", () => {
    for (const file of NOINDEX_AUTH_FILES) {
      const source = read(file);
      expect(source).toContain("robots: { index: false, follow: false }");
    }
  });
});

describe("footer", () => {
  it("links only to real routes or the confirmed external profile, never a placeholder", () => {
    const source = read("src/components/marketing/marketing-footer.tsx");
    expect(source).not.toContain('href="#"');
    expect(source).toContain('href: "/product"');
    expect(source).toContain('href: "/pricing"');
    expect(source).toContain('href: "/about"');
    expect(source).toContain('href: "/contact"');
    expect(source).toContain('href: "/privacy"');
    expect(source).toContain('href: "/terms"');
    expect(source).toContain('href: "/cookies"');
    expect(source).toContain("X_PROFILE_URL");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });

  it("never leaves Privacy/Terms/X as unlinked static text", () => {
    const source = read("src/components/marketing/marketing-footer.tsx");
    expect(source).not.toMatch(/<span>\s*(Privacy|Terms|X)\s*<\/span>/);
  });
});

describe("contact page", () => {
  it("uses the real confirmed support email, not an invented or unrelated address", () => {
    expect(SUPPORT_EMAIL).toBe("support@wanterest.com");
    const source = read("src/components/marketing/contact-form.tsx");
    expect(source).toContain("SUPPORT_EMAIL");
    expect(source).not.toContain("@example.com");
  });
});

describe("pricing consistency", () => {
  it("reuses the single homepage PricingSection instead of duplicating plan copy on /pricing", () => {
    const source = read("src/app/pricing/page.tsx");
    expect(source).toContain('import { PricingSection } from "@/components/marketing/pricing";');
    expect(source).toContain("<PricingSection />");
    // No hand-duplicated plan numbers on the page itself.
    expect(source).not.toMatch(/\$49|\$468|\$99|\$948/);
  });
});

describe("signup consent line", () => {
  it("links to the now-real Terms and Privacy pages", () => {
    const source = read("src/components/auth/signup-form.tsx");
    expect(source).toContain("/terms");
    expect(source).toContain("/privacy");
    expect(source).toContain("agree to the");
  });
});
