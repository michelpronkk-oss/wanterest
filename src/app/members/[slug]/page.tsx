import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicCohortPassQuery, publicMemberPassPresentation } from "@/server/modules/cohort-public";
import { FounderPassArtwork } from "@/components/members/member-identity";

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

export default async function MemberPassPage({ params }: PageProps) {
  const { slug } = await params;
  const profile = await getPublicCohortPassQuery(slug);
  if (!profile) notFound();
  const presentation = publicMemberPassPresentation(profile);
  const cohortLabel = presentation.label;
  const number = presentation.serial;
  return (
    <main className="marketing-content-wrap" aria-labelledby="member-pass-title">
      <div className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> {cohortLabel}</div>
      <FounderPassArtwork {...presentation} />
      <h1 id="member-pass-title">{profile.displayName}</h1>
      <p>{profile.headline ?? "Public member"}</p>
      <dl>
        <div><dt>Cohort</dt><dd>{cohortLabel}</dd></div>
        <div><dt>Identity</dt><dd>{number}</dd></div>
        <div><dt>Member since</dt><dd>{new Date(profile.assignedAt).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}</dd></div>
      </dl>
      {profile.websiteUrl ? <p><a href={profile.websiteUrl} rel="noreferrer">Visit website</a></p> : null}
      <p>This public pass represents workspace cohort provenance. It is not an access token, invitation, or billing credential.</p>
    </main>
  );
}
