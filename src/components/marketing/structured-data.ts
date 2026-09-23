import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/shared/config/seo";
import { SITE_ORIGIN, X_PROFILE_URL } from "@/shared/config/site";

/**
 * Homepage-only Schema.org JSON-LD. Every field here must be verifiable truth —
 * no aggregateRating/review/customerCount/award/foundingDate/address, and `sameAs`
 * only lists real, confirmed Wanterest profiles.
 */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    description: DEFAULT_DESCRIPTION,
    sameAs: [X_PROFILE_URL],
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_ORIGIN };
}

export function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    description: DEFAULT_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: [
      { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro", price: "49", priceCurrency: "USD" },
      { "@type": "Offer", name: "Growth", price: "99", priceCurrency: "USD" },
    ],
  };
}
