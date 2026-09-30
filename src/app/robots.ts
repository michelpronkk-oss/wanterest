import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { robotsForHostname } from "@/shared/config/seo-host";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  return robotsForHostname(requestHeaders.get("host"));
}
