import type { MetadataRoute } from "next";

import { LEGAL_LAST_UPDATED } from "@/shared/config/seo";
import { SITE_ORIGIN } from "@/shared/config/site";

const MARKETING_ROUTES = ["", "/product", "/pricing", "/about", "/contact"] as const;
const LEGAL_ROUTES = ["/privacy", "/terms", "/cookies"] as const;
const PRIVATE_CRAWL_PATHS = [
  "/admin-internal",
  "/app/",
  "/login",
  "/signup",
  "/start",
  "/forgot-password",
  "/auth/",
  "/api/",
] as const;

export const CANONICAL_MARKETING_HOST = "www.wanterest.com";

export function normalizeRequestHostname(host: string | null | undefined): string {
  if (!host) return "";
  try {
    return new URL(`http://${host.trim()}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function isCanonicalMarketingRequest(host: string | null | undefined): boolean {
  const hostname = normalizeRequestHostname(host);
  if (hostname === CANONICAL_MARKETING_HOST) return true;
  return process.env.NODE_ENV !== "production" && isLocalHostname(hostname);
}

export function sitemapForHostname(host: string | null | undefined): MetadataRoute.Sitemap {
  if (!isCanonicalMarketingRequest(host)) return [];

  return [
    ...MARKETING_ROUTES.map((route) => ({ url: `${SITE_ORIGIN}${route}` })),
    ...LEGAL_ROUTES.map((route) => ({ url: `${SITE_ORIGIN}${route}`, lastModified: LEGAL_LAST_UPDATED })),
  ];
}

export function robotsForHostname(host: string | null | undefined): MetadataRoute.Robots {
  if (!isCanonicalMarketingRequest(host)) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  const marketingRules = PRIVATE_CRAWL_PATHS.slice();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...marketingRules],
      },
      {
        // Keep ChatGPT Search discoverability independently controllable from GPTBot.
        // GPTBot retains the existing wildcard policy unless an explicit group is approved.
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: [...marketingRules],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
