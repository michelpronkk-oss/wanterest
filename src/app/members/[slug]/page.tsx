import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicCohortPassQuery, publicMemberPassPresentation } from "@/server/modules/cohort-public";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { MemberProfileView } from "@/components/members/member-profile";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getPublicCohortPassQuery(slug);
  if (!profile) return { title: "Member unavailable", robots: { index: false, follow: false } };
  const cohortLabel = profile.cohort === "founding_25" ? "Founding 25" : "Early 100";
  return {
    title: `${profile.displayName} · ${cohortLabel}`,
    description: profile.headline ?? `${profile.displayName} is part of the public ${cohortLabel} community.`,
    alternates: { canonical: profile.canonicalUrl },
  };
}

/**
 * Apex 2.0 boards 11 (desktop) and 12 (mobile). Publication authority is the
 * current pass-visible RPC read above, never the slug or a wall row. "Share
 * pass" is intentionally absent: public sharing belongs to the unreleased 13B
 * layer and stays inactive here.
 */
export default async function MemberPassPage({ params }: PageProps) {
  const { slug } = await params;
  const profile = await getPublicCohortPassQuery(slug);
  if (!profile) notFound();
  const presentation = publicMemberPassPresentation(profile);
  return (
    <MarketingPageShell>
      <MemberProfileView presentation={presentation} canonicalUrl={profile.canonicalUrl} websiteUrl={profile.websiteUrl} />
    </MarketingPageShell>
  );
}
