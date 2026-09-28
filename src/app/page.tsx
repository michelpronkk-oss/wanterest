import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { JsonLd } from "@/components/marketing/json-ld";
import { MarketingHome } from "@/components/marketing/marketing-home";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "@/components/marketing/structured-data";
import { getCurrentUser } from "@/server/modules/auth";
import { getHomepageAccessState, getProductAccessState, type HomepageAccessContext } from "@/server/modules/access";
import { createWaitlistService } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { cookies } from "next/headers";
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

  const access = await getProductAccessState();
  const accessState = await getHomepageState(access.mode);
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={softwareApplicationJsonLd()} />
      <MarketingHome accessState={accessState} />
    </>
  );
}

/**
 * The homepage only uses this context to choose a destination. It never renders
 * application data. The waitlist service remains the authority for every state.
 */
async function getHomepageState(mode: Parameters<typeof getHomepageAccessState>[0]) {
  const context: HomepageAccessContext = {};

  try {
    context.authenticated = Boolean(await getCurrentUser());
  } catch {
    // An unavailable auth provider must not make the public marketing page fail.
  }

  try {
    const token = (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value;
    if (token) {
      const status = await createWaitlistService().statusWithReferral(token);
      const applicationStatus = status.application.status;
      const eligible = applicationStatus !== "declined" && applicationStatus !== "withdrawn";
      if (!eligible) return getHomepageAccessState(mode, context);

      if (context.authenticated && status.admission?.admissionStatus === "admitted") {
        context.admitted = true;
      } else if (status.admission?.inviteStatus === "issued") {
        context.waitlistState = "invited";
      } else if (status.referral?.priorityUnlocked) {
        context.waitlistState = "priority";
      } else if (applicationStatus === "verified" || applicationStatus === "under_review" || applicationStatus === "approved_for_invite") {
        context.waitlistState = "verified";
      } else {
        context.waitlistState = "submitted";
      }
    }
  } catch {
    // The default access-mode destination is safer than guessing a private state.
  }

  return getHomepageAccessState(mode, context);
}
