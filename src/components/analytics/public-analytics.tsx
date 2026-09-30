"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SITE_ORIGIN } from "@/shared/config/site";

const analyticsPaths = new Set([
  "/",
  "/about",
  "/contact",
  "/cookies",
  "/pricing",
  "/privacy",
  "/product",
  "/terms",
  "/waitlist",
]);

function filterPublicAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url, SITE_ORIGIN);
    if (!analyticsPaths.has(url.pathname)) return null;

    // Exclude query parameters so verification links, referral parameters and form
    // prefill data never become analytics dimensions.
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

export function PublicAnalytics() {
  return <Analytics beforeSend={filterPublicAnalyticsEvent} />;
}
