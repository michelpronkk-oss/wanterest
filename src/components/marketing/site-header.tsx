import "server-only";

import { cookies } from "next/headers";

import { getCurrentUser } from "@/server/modules/auth";
import { getHomepageAccessState, getProductAccessState, type AccessMode, type HomepageAccessContext, type HomepageAccessState } from "@/server/modules/access";
import { createWaitlistService } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { MarketingNav } from "./marketing-nav";

/**
 * The visitor's one state-aware action, shared by every page's header and the homepage hero.
 * Only chooses a destination — it never renders application data — and the waitlist service
 * remains the authority for every state. Any provider failure falls back to the access mode.
 */
export async function getVisitorAccessState(mode: AccessMode): Promise<HomepageAccessState> {
  const context: HomepageAccessContext = {};

  try {
    context.authenticated = Boolean(await getCurrentUser());
  } catch {
    // An unavailable auth provider must not make a public page fail.
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

/** The one site header for every public page (the homepage renders the same SiteNav in its hero stage). */
export async function SiteHeader({ activeHref }: { activeHref?: string }) {
  let accessState: HomepageAccessState;
  try {
    const access = await getProductAccessState();
    accessState = await getVisitorAccessState(access.mode);
  } catch {
    accessState = getHomepageAccessState("invite_only");
  }
  return <MarketingNav accessState={accessState} activeHref={activeHref} />;
}
