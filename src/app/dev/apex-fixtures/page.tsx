import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { MembershipSection } from "@/components/dashboard/membership-section";
import { WorkspaceCohortIdentity } from "@/components/dashboard/workspace-cohort-identity";
import { ApexMark, ApexPlate } from "@/components/identity/apex-artwork";
import { FounderPassArtwork } from "@/components/members/founder-pass";
import { MemberIdentity } from "@/components/members/member-identity-client";
import { AccessStatusChip, CohortBadge, EarlyAccessPill, PriorityPill, PublicationChip, WorkspaceActivity } from "@/components/members/member-identity-slots";
import { MemberProfileView } from "@/components/members/member-profile";
import { MemberWallCard } from "@/components/members/member-wall-card";
import { PublicMembersWall } from "@/components/members/public-members-wall";
import { describeStatus, earlyAccessLabel, formatJourneyDate, resolveReveal, type JourneyAdmission, type JourneyApplication, type JourneyReferral } from "@/components/waitlist/journey";
import { JourneyShell, PrivateStatus, VerifiedReveal } from "@/components/waitlist/journey-views";
import { MembershipLadder } from "@/components/waitlist/membership-ladder";
import { admittedCohortPresentation, admissionMonth, admissionMonthLong } from "@/shared/member-presentation";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { earlyRows, foundingRows, identities, LONG_NAME } from "./fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Apex fixtures", robots: { index: false, follow: false } };

/**
 * Isolated visual-QA harness for the Apex 2.0 integration. Disabled unless the
 * dev server runs with APEX_FIXTURES=1; always 404 in production builds. All
 * data is labeled fixture data rendered through the real production components.
 */
function enabled() {
  return process.env.NODE_ENV !== "production" && process.env.APEX_FIXTURES === "1";
}

function Banner() {
  return <div style={{ padding: "8px 16px", background: "#fff3c4", color: "#6b4e00", fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textAlign: "center" }}>VISUAL QA FIXTURE — fictional, labeled data; not real members or admissions</div>;
}

function Panel({ title, children, dark = false }: { title: string; children: ReactNode; dark?: boolean }) {
  return (
    <section style={{ padding: 24, borderRadius: 16, background: dark ? "#111110" : "#fff", boxShadow: "inset 0 0 0 1px rgba(17,17,16,.08)", display: "grid", gap: 14, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8c8c82" }}>{title}</h2>
      {children}
    </section>
  );
}

const row = { display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 12 };

function profilePresentation(cohort: "founding_25" | "early_100", number: number, identity: PublicMemberIdentity = identities.logo, displayName = "Fixture Logo Co", headline: string | null = "Fixture headline: demand intelligence for industrial buyers") {
  const assignedAt = "2026-03-04T00:00:00Z";
  return { ...admittedCohortPresentation(cohort, number), displayName, headline, admissionMonth: admissionMonth(assignedAt), admissionMonthLong: admissionMonthLong(assignedAt), identity };
}

const application: JourneyApplication = { status: "verified", earlyAccessNumber: 184, email: "fixture@example.test", companyName: "Fixture Co", createdAt: "2026-09-20T10:00:00Z", verifiedAt: "2026-09-20T10:05:00Z", marketingConsent: false };
const referralNormal: JourneyReferral = { priorityStatus: "normal", priorityUnlocked: false, priorityGrantedAt: null, verifiedCount: 1, threshold: 3, remainingCount: 2, shareUrl: null };
const referralPriority: JourneyReferral = { ...referralNormal, priorityStatus: "granted", priorityUnlocked: true, priorityGrantedAt: "2026-09-24T09:00:00Z", verifiedCount: 3, remainingCount: 0 };
const referralRevoked: JourneyReferral = { ...referralNormal, priorityStatus: "revoked", priorityUnlocked: false, priorityGrantedAt: null };
const admitted: JourneyAdmission = { inviteStatus: "accepted", inviteExpiresAt: null, admissionStatus: "admitted", cohort: "founding_25", cohortNumber: 7, displayIdentity: "Founding 25", admittedAt: "2026-09-28T12:00:00Z" };

function Status({ referral, admission, app = application }: { referral: JourneyReferral; admission: JourneyAdmission | null; app?: JourneyApplication }) {
  const view = describeStatus(app, referral, admission, new Date("2026-09-29T00:00:00Z"));
  const earlyAccess = earlyAccessLabel(app.earlyAccessNumber) ?? "Pending";
  return (
    <JourneyShell indicator={`Private status · ${app.email}`} mobileBadge={view.variant === "priority" ? <PriorityPill status="granted" earlyAccessNumber={app.earlyAccessNumber} size="compact" /> : <EarlyAccessPill number={app.earlyAccessNumber} size="compact" />}>
      <PrivateStatus view={view} earlyAccess={earlyAccess} earlyAccessNumber={app.earlyAccessNumber} details={{ submitted: formatJourneyDate(app.createdAt), company: app.companyName, email: app.email, marketingConsent: app.marketingConsent }} />
    </JourneyShell>
  );
}

export default async function ApexFixtures({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!enabled()) notFound();
  const { view = "index" } = await searchParams;
  const action = { href: "/waitlist", label: "Request access", description: "Request access to join the Wanterest waitlist." };

  switch (view) {
    case "wall":
      return <><Banner /><MarketingPageShell accessMode="invite_only"><PublicMembersWall founding={foundingRows} early={earlyRows} primaryAction={action} /></MarketingPageShell></>;
    case "wall-empty":
      return <><Banner /><MarketingPageShell accessMode="invite_only"><PublicMembersWall founding={[]} early={[]} primaryAction={action} /></MarketingPageShell></>;
    case "profile-founding":
      return <><Banner /><MarketingPageShell accessMode="invite_only"><MemberProfileView presentation={profilePresentation("founding_25", 7)} canonicalUrl="https://wanterest.com/members/fixture-logo" websiteUrl={null} /></MarketingPageShell></>;
    case "profile-early":
      return <><Banner /><MarketingPageShell accessMode="invite_only"><MemberProfileView presentation={profilePresentation("early_100", 42, identities.avatar, "Fixture Avatar Person", "Fixture founder, avatar only")} canonicalUrl="https://wanterest.com/members/fixture-avatar" websiteUrl={null} /></MarketingPageShell></>;
    case "profile-long":
      return <><Banner /><MarketingPageShell accessMode="invite_only"><MemberProfileView presentation={profilePresentation("founding_25", 12, identities.monogram3, LONG_NAME, null)} canonicalUrl="https://wanterest.com/members/fixture-long" websiteUrl={null} /></MarketingPageShell></>;
    case "profile-unavailable":
      notFound();
    case "settings":
      return (
        <><Banner />
          <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
            <MembershipSection data={{ workspaceId: "00000000-0000-4000-8000-00000000f1c5", publicOrigin: "https://wanterest.com", cohort: { state: "member", cohort: "founding_25", number: 7, workspaceStatus: "active" }, profile: { form: { publicSlug: "fixture-logo", displayName: "Fixture Logo Co", headline: "Fixture headline", logoUrl: "https://assets.fixture.example.com/logo.png", avatarUrl: null, websiteUrl: null, monogram: "FL", wallVisible: true, passVisible: false }, preview: { displayName: "Fixture Logo Co", headline: "Fixture headline", admissionMonth: "Mar 2026", identity: identities.logo, cohort: "founding_25", number: 7 } } }} />
            <div style={{ height: 24 }} />
            <MembershipSection data={{ workspaceId: "00000000-0000-4000-8000-00000000f1c6", publicOrigin: "https://wanterest.com", cohort: { state: "none", workspaceStatus: "active" }, profile: null }} />
            <div style={{ height: 24 }} />
            <MembershipSection data={{ workspaceId: "00000000-0000-4000-8000-00000000f1c7", publicOrigin: "https://wanterest.com", cohort: { state: "member", cohort: "early_100", number: 42, workspaceStatus: "suspended" }, profile: null }} />
          </div>
        </>
      );
    case "verified": {
      const resolution = resolveReveal(application, referralNormal, null, new Date("2026-09-29T00:00:00Z"));
      return <><Banner /><JourneyShell nav="marketing">{resolution.kind === "reveal" ? <VerifiedReveal model={resolution.model} actions={null} /> : null}</JourneyShell></>;
    }
    case "status":
      return <><Banner /><Status referral={referralNormal} admission={null} /></>;
    case "status-priority":
      return <><Banner /><Status referral={referralPriority} admission={null} /></>;
    case "status-revoked":
      return <><Banner /><Status referral={referralRevoked} admission={null} /></>;
    case "status-admitted":
      return <><Banner /><Status referral={referralNormal} admission={admitted} app={{ ...application, status: "approved_for_invite" }} /></>;
    default:
      return (
        <><Banner />
          <main style={{ maxWidth: 1240, margin: "0 auto", padding: 24, display: "grid", gap: 18, background: "#ecebe4" }}>
            <Panel title="Apex marks · micro (<24px) and standard cut">
              <div style={row}>
                {[16, 20, 23, 24, 32, 48, 64].map((size) => <ApexMark key={size} size={size} fill="founding-light" />)}
                {[16, 24, 48].map((size) => <ApexMark key={`e${size}`} size={size} fill="early-light" />)}
              </div>
            </Panel>
            <Panel title="Plates · scale ladder 16 → 64">
              <div style={row}>{[16, 20, 24, 32, 48, 64].map((size) => <ApexPlate key={size} size={size} edition="founding" />)}</div>
              <div style={row}>{[16, 20, 24, 32, 48, 64].map((size) => <ApexPlate key={size} size={size} edition="early" />)}</div>
            </Panel>
            <Panel title="Badges · light surface">
              <div style={row}>
                <CohortBadge cohort="founding_25" number={7} /><CohortBadge cohort="early_100" number={42} />
                <CohortBadge cohort="founding_25" number={25} size="compact" /><CohortBadge cohort="early_100" number={100} size="compact" />
                <CohortBadge cohort="founding_25" number={7} size="micro" /><CohortBadge cohort="early_100" number={42} size="micro" />
                <CohortBadge cohort="founding_25" /><CohortBadge cohort="early_100" />
              </div>
              <div style={row}><PriorityPill status="granted" earlyAccessNumber={184} /><PriorityPill status="revoked" earlyAccessNumber={184} /><EarlyAccessPill number={184} /><EarlyAccessPill number={2} /><EarlyAccessPill number={12408} /><EarlyAccessPill number={184} size="compact" /></div>
              <div style={row}>
                {(["pending", "email_confirmed", "review", "priority", "invite_ready", "invited", "admitted"] as const).map((status) => <AccessStatusChip key={status} status={status} />)}
              </div>
              <div style={row}><WorkspaceActivity active /><WorkspaceActivity active={false} /><PublicationChip surface="wall" visible /><PublicationChip surface="wall" visible={false} /><PublicationChip surface="pass" visible /><PublicationChip surface="pass" visible={false} /></div>
            </Panel>
            <Panel title="Badges · dark surface" dark>
              <div style={row}>
                <CohortBadge cohort="founding_25" number={7} tone="dark" /><CohortBadge cohort="early_100" number={42} tone="dark" />
                <CohortBadge cohort="founding_25" number={7} size="compact" tone="dark" /><CohortBadge cohort="founding_25" number={7} size="micro" tone="dark" /><CohortBadge cohort="early_100" number={42} size="micro" tone="dark" />
                <PriorityPill status="granted" earlyAccessNumber={184} tone="dark" /><EarlyAccessPill number={184} tone="dark" /><WorkspaceActivity active tone="dark" />
              </div>
            </Panel>
            <Panel title="Identity fallbacks · logo, avatar, monogram 1/2/3, neutral, failed logo, failed logo+avatar">
              {[20, 32, 40, 56, 96].map((size) => (
                <div key={size} style={row}>
                  <MemberIdentity identity={identities.logo} size={size} /><MemberIdentity identity={identities.wideLogo} size={size} /><MemberIdentity identity={identities.avatar} size={size} />
                  <MemberIdentity identity={identities.monogram1} size={size} /><MemberIdentity identity={identities.monogram2} size={size} /><MemberIdentity identity={identities.monogram3} size={size} />
                  <MemberIdentity identity={identities.placeholder} size={size} /><MemberIdentity identity={identities.brokenLogo} size={size} /><MemberIdentity identity={identities.brokenBoth} size={size} />
                  <span style={{ fontSize: 11, color: "#a3a399" }}>{size}px</span>
                </div>
              ))}
            </Panel>
            <Panel title="Member cards · Founding / Early / no headline / long name / compact">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <MemberWallCard {...foundingRows[0]} admissionMonth="Mar 2026" />
                <MemberWallCard {...earlyRows[0]} admissionMonth="Mar 2026" />
                <MemberWallCard {...foundingRows[6]} admissionMonth="May 2026" />
                <MemberWallCard {...foundingRows[5]} admissionMonth="Apr 2026" />
              </div>
              <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                <MemberWallCard {...foundingRows[1]} admissionMonth="Mar 2026" variant="compact" />
                <MemberWallCard {...earlyRows[3]} admissionMonth="Apr 2026" variant="compact" />
                <MemberWallCard {...foundingRows[5]} admissionMonth="Apr 2026" variant="compact" />
              </div>
            </Panel>
            <Panel title="Founder Pass · Founding 25 horizontal / vertical / compact">
              <FounderPassArtwork {...profilePresentation("founding_25", 7)} />
              <div style={row}>
                <div style={{ width: 340 }}><FounderPassArtwork {...profilePresentation("founding_25", 7)} layout="vertical" /></div>
                <div style={{ width: 340 }}><FounderPassArtwork {...profilePresentation("founding_25", 12, identities.monogram2, "Fixture Two Letters", null)} layout="vertical" /></div>
                <div style={{ width: 340, display: "grid", gap: 10 }}>
                  <FounderPassArtwork {...profilePresentation("founding_25", 7)} layout="compact" />
                  <FounderPassArtwork {...profilePresentation("founding_25", 25, identities.monogram3, LONG_NAME)} layout="compact" />
                </div>
              </div>
            </Panel>
            <Panel title="Early 100 Public Pass · horizontal / vertical / compact">
              <FounderPassArtwork {...profilePresentation("early_100", 42, identities.avatar, "Fixture Avatar Person", "Fixture founder, avatar only")} />
              <div style={row}>
                <div style={{ width: 340 }}><FounderPassArtwork {...profilePresentation("early_100", 42, identities.monogram2, "Fixture Two Letters", null)} layout="vertical" /></div>
                <div style={{ width: 340, display: "grid", gap: 10 }}>
                  <FounderPassArtwork {...profilePresentation("early_100", 1)} layout="compact" />
                  <FounderPassArtwork {...profilePresentation("early_100", 100, identities.placeholder, "Fixture Neutral")} layout="compact" />
                </div>
              </div>
            </Panel>
            <Panel title="Compact application identity · sidebar pill + tooltip, topbar micro">
              <div style={{ ...row, alignItems: "flex-end", minHeight: 110 }}>
                <div style={{ width: 216, padding: 12, borderRadius: 12, background: "#fff", boxShadow: "inset 0 0 0 1px rgba(17,17,16,.08)", display: "grid", gap: 10 }}><WorkspaceCohortIdentity cohort="founding_25" number={7} /></div>
                <div style={{ width: 216, padding: 12, borderRadius: 12, background: "#fff", boxShadow: "inset 0 0 0 1px rgba(17,17,16,.08)", display: "grid", gap: 10 }}><WorkspaceCohortIdentity cohort="early_100" number={42} /></div>
                <CohortBadge cohort="founding_25" number={7} size="micro" /><CohortBadge cohort="early_100" number={42} size="micro" />
              </div>
            </Panel>
            <Panel title="Membership ladder (Request Access badge leaves)"><MembershipLadder /></Panel>
          </main>
        </>
      );
  }
}
