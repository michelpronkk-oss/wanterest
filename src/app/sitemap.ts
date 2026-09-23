import type { MetadataRoute } from "next";

import { LEGAL_LAST_UPDATED } from "@/shared/config/seo";
import { SITE_ORIGIN } from "@/shared/config/site";

// Only indexable public marketing pages. Never list /app/**, auth routes, or /api/**.
const MARKETING_ROUTES = ["", "/product", "/pricing", "/about", "/contact"];
// Legal pages carry a real, meaningful "Last updated" date shown on the page itself.
const LEGAL_ROUTES = ["/privacy", "/terms", "/cookies"];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...MARKETING_ROUTES.map((route) => ({ url: `${SITE_ORIGIN}${route}` })),
    ...LEGAL_ROUTES.map((route) => ({ url: `${SITE_ORIGIN}${route}`, lastModified: LEGAL_LAST_UPDATED })),
  ];
}
