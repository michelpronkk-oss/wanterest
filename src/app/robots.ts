import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/shared/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Disallow is a path-prefix match, so each entry also covers its sub-routes
      // (e.g. "/forgot-password" covers "/forgot-password/update").
      disallow: ["/app/", "/login", "/signup", "/start", "/forgot-password", "/auth/", "/api/"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
