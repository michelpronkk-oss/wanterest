import type { Metadata } from "next";

import { PublicMembersWall } from "@/components/members/public-members-wall";
import { APP_START_URL } from "@/components/marketing/links";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { getHomepageAccessState, getProductAccessState } from "@/server/modules/access";
import { getPublicCohortWallsQuery } from "@/server/modules/cohort-public";
import { selectPublicMemberIdentity } from "@/server/modules/cohort-public/cohort-public.identity";
import { APP_ORIGIN } from "@/shared/config/site";

export const dynamic = "force-dynamic";

const TITLE = "Wanterest Members — Public Cohort Wall";
const DESCRIPTION = "The public, opt-in Founding 25 and Early 100 members of Wanterest.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/members" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/members" },
};

function primaryAction(mode: Parameters<typeof getHomepageAccessState>[0]) {
  const state = getHomepageAccessState(mode);
  const label = {
    REQUEST_ACCESS: "Request access",
    START_FREE: "Start free",
    CHECK_EMAIL: "Check your email",
    VIEW_STATUS: "View status",
    VIEW_PRIORITY_STATUS: "View Priority status",
    ACCEPT_INVITATION: "Accept invitation",
    OPEN_WANTEREST: "Open Wanterest",
  }[state.primaryAction];
  // Board 06 supporting line is specific to the waitlist CTA; other access modes show the label alone.
  const description = state.primaryAction === "REQUEST_ACCESS" ? "Request access to join the Wanterest waitlist." : null;
  return { label, description, href: state.primaryAction === "START_FREE" ? APP_START_URL : `${APP_ORIGIN}${state.primaryActionHref}` };
}

export default async function MembersPage() {
  const [walls, access] = await Promise.all([getPublicCohortWallsQuery(), getProductAccessState()]);
  const wallRows = {
    founding: walls.founding.map((row) => ({
      publicSlug: row.publicSlug,
      displayName: row.displayName,
      headline: row.headline,
      cohort: row.cohort,
      number: row.number,
      assignedAt: row.assignedAt,
      identity: selectPublicMemberIdentity(row),
    })),
    early: walls.early.map((row) => ({
      publicSlug: row.publicSlug,
      displayName: row.displayName,
      headline: row.headline,
      cohort: row.cohort,
      number: row.number,
      assignedAt: row.assignedAt,
      identity: selectPublicMemberIdentity(row),
    })),
  };
  return (
    <MarketingPageShell accessMode={access.mode}>
      <PublicMembersWall founding={wallRows.founding} early={wallRows.early} primaryAction={primaryAction(access.mode)} />
    </MarketingPageShell>
  );
}
