import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { sitemapForHostname } from "@/shared/config/seo-host";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  return sitemapForHostname(requestHeaders.get("host"));
}
