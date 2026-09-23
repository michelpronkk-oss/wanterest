import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { JsonLd } from "@/components/marketing/json-ld";
import { MarketingHome } from "@/components/marketing/marketing-home";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "@/components/marketing/structured-data";
import { getCurrentUser } from "@/server/modules/auth";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/shared/config/seo";
import { isAppHost } from "@/shared/config/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Bypasses the root layout's "%s — Wanterest" template: this title is already complete.
  title: { absolute: DEFAULT_TITLE },
  description: DEFAULT_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url: "/" },
  twitter: { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
};

export default async function Home() {
  const requestHeaders = await headers();

  // app.wanterest.com/ is the auth/onboarding surface: send it to the product or the login
  // screen. www.wanterest.com/ (and any other host, e.g. local dev) is always the marketing
  // homepage — authenticated visitors must still be able to load it, so it is never redirected.
  if (isAppHost(requestHeaders.get("host"))) {
    const user = await getCurrentUser();
    redirect(user ? "/app" : "/login");
  }

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={softwareApplicationJsonLd()} />
      <MarketingHome />
    </>
  );
}
