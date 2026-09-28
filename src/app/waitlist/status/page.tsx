import { createWaitlistService } from "@/server/modules/waitlist";
import { cookies } from "next/headers";

import { WaitlistWithdrawButton } from "@/components/waitlist/waitlist-withdraw-button";
import { ShareCardPanel } from "@/components/share-cards/share-card-panel";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import type { WaitlistAdmissionStatus, WaitlistApplication, WaitlistReferralReadModel } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { getApplicantShareCardsQuery } from "@/server/modules/share-cards";

export const dynamic = "force-dynamic";

type LedgerTone = "done" | "now" | "next" | "off";
type LedgerNode = { label: string; tone: LedgerTone; meta: string };
type ChipTone = "neutral" | "priority" | "invite" | "muted";

type StatusView = {
  chip: { label: string; tone: ChipTone };
  title: string;
  body: string;
  ledger: LedgerNode[];
};

function earlyAccessLabel(application: WaitlistApplication): string {
  return application.earlyAccessNumber ? `#${String(application.earlyAccessNumber).padStart(4, "0")}` : "Pending verification";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Everything here comes from the real application/referral/admission record — no invented queue
 * movement, no fabricated dates. Priority is rendered as an overlay on whatever the real
 * application.status is (verified or under_review), never as a status of its own, matching Layer
 * 13A.3: Priority is a separate authoritative grant, not a waitlist application status.
 */
function describeStatus(application: WaitlistApplication, referral: WaitlistReferralReadModel | null, admission: WaitlistAdmissionStatus | null | undefined): StatusView {
  const priority = referral?.priorityUnlocked ?? false;
  const reviewLabel = priority ? "Priority" : "Review";
  const requested: LedgerNode = { label: "Requested", tone: "done", meta: formatDate(application.createdAt) };
  const verifiedNode = (tone: LedgerTone): LedgerNode => ({ label: "Verified", tone, meta: application.verifiedAt ? formatDate(application.verifiedAt) : "Waiting" });

  if (application.status === "pending") {
    return {
      chip: { label: "Pending", tone: "muted" },
      title: "Confirm your email",
      body: "Your place isn't reserved until you confirm the link we sent you.",
      ledger: [requested, verifiedNode("next"), { label: reviewLabel, tone: "next", meta: "—" }, { label: "Invite", tone: "next", meta: "—" }],
    };
  }

  if (application.status === "declined") {
    return {
      chip: { label: "Not selected", tone: "muted" },
      title: "Not this round",
      body: "We couldn't offer access this time. Your Early Access number stays yours if we open more places.",
      ledger: [requested, verifiedNode("done"), { label: reviewLabel, tone: "done", meta: "Closed" }, { label: "Invite", tone: "off", meta: "—" }],
    };
  }

  if (application.status === "withdrawn") {
    return {
      chip: { label: "Withdrawn", tone: "muted" },
      title: "Request withdrawn",
      body: `You won't be considered for access. ${earlyAccessLabel(application)} remains reserved as part of your history.`,
      ledger: [requested, verifiedNode("done"), { label: reviewLabel, tone: "off", meta: "—" }, { label: "Invite", tone: "off", meta: "—" }],
    };
  }

  if (application.status === "approved_for_invite") {
    const invited = admission?.inviteStatus === "issued";
    return {
      chip: { label: "Invite ready", tone: "invite" },
      title: "You're invited",
      body: invited && admission?.inviteExpiresAt
        ? `Your workspace is ready to be created. Check your email for the invite link — it expires ${formatDate(admission.inviteExpiresAt)}.`
        : "Your workspace is ready to be created. Check your email for the invite link.",
      ledger: [requested, verifiedNode("done"), { label: reviewLabel, tone: "done", meta: "Reviewed" }, { label: "Invite", tone: "now", meta: invited ? "Sent" : "Ready" }],
    };
  }

  if (priority) {
    return {
      chip: { label: "Priority access", tone: "priority" },
      title: "You're closer to the front",
      body: "Your request moved forward in review. It isn't an invite yet.",
      ledger: [requested, verifiedNode("done"), { label: "Priority", tone: "now", meta: referral?.priorityGrantedAt ? formatDate(referral.priorityGrantedAt) : "Now" }, { label: "Invite", tone: "next", meta: "Not yet" }],
    };
  }

  if (application.status === "under_review") {
    return {
      chip: { label: "Under review", tone: "neutral" },
      title: "We're reviewing your request",
      body: "A person reads every request. Invites go out in waves, so this can take a few weeks.",
      ledger: [requested, verifiedNode("done"), { label: reviewLabel, tone: "now", meta: "In progress" }, { label: "Invite", tone: "next", meta: "Not yet" }],
    };
  }

  return {
    chip: { label: "Verified", tone: "neutral" },
    title: "You're verified",
    body: `Early Access ${earlyAccessLabel(application)} is recorded. Review starts shortly.`,
    ledger: [requested, verifiedNode("done"), { label: reviewLabel, tone: "now", meta: "Soon" }, { label: "Invite", tone: "next", meta: "Not yet" }],
  };
}

function LedgerDot({ tone }: { tone: LedgerTone }) {
  return <span className={`ea-ledger-dot is-${tone}`} aria-hidden="true" />;
}

function Ledger({ nodes }: { nodes: LedgerNode[] }) {
  return (
    <ol className="ea-ledger" aria-label="Application progress">
      {nodes.map((node, index) => (
        <li key={node.label} className={`ea-ledger-node is-${node.tone}`}>
          <LedgerDot tone={node.tone} />
          <span className="ea-ledger-label">{node.label}</span>
          <span className="ea-ledger-meta">{node.meta}</span>
          {index < nodes.length - 1 ? <span className={`ea-ledger-line${node.tone === "done" ? " is-done" : ""}`} aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

export default async function WaitlistStatusPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(WAITLIST_STATUS_COOKIE)?.value ?? "";
  if (!token) return <StatusUnavailable />;
  const status = await loadStatus(token);
  if (!status) return <StatusUnavailable />;
  const shareCards = await getApplicantShareCardsQuery(token).catch(() => []);
  const { application, referral, admission } = status;

  if (admission?.admissionStatus === "admitted") {
    return (
      <MarketingPageShell activeHref="/waitlist">
        <main className="ea-status-page">
          <div className="ea-status-card">
            <div className="ea-status-chip is-invite"><span className="ea-status-chip-dot" aria-hidden="true" />Admitted</div>
            <h1>Your Wanterest access is ready.</h1>
            <p className="ea-status-body">Your invitation is complete and your workspace is ready.</p>
            {admission.displayIdentity ? <p className="ea-status-body"><strong>{admission.displayIdentity} · #{String(admission.cohortNumber).padStart(admission.cohort === "founding_25" ? 2 : 3, "0")}</strong></p> : null}
            <a className="dashboard-button dashboard-button-primary ea-submit" href="/app">Open Wanterest →</a>
          </div>
        </main>
      </MarketingPageShell>
    );
  }

  const view = describeStatus(application, referral, admission);
  const canWithdraw = application.status !== "withdrawn" && application.status !== "declined";

  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="ea-status-page">
        <div className="ea-status-grid">
          <div className="ea-status-main">
            <div className={`ea-status-chip is-${view.chip.tone}`}><span className="ea-status-chip-dot" aria-hidden="true" />{view.chip.label}</div>
            <h1>{view.title}</h1>
            <p className="ea-status-body">{view.body}</p>
            <Ledger nodes={view.ledger} />
            <dl className="ea-status-details">
              <div><dt>Submitted</dt><dd>{formatDate(application.createdAt)}</dd></div>
              <div><dt>Company</dt><dd>{application.companyName}</dd></div>
              <div><dt>Email</dt><dd>{application.email}</dd></div>
              <div><dt>Product updates</dt><dd>{application.marketingConsent ? "Subscribed" : "Not subscribed"}</dd></div>
            </dl>
            <div className="ea-status-actions">
              {canWithdraw ? <WaitlistWithdrawButton /> : null}
            </div>
          </div>
          <aside className="ea-status-side">
            <div className="ea-identity-card is-compact">
              <div className="ea-identity-head"><span>Early access</span><span className="ea-identity-permanent">Permanent</span></div>
              <div className="ea-identity-number">{earlyAccessLabel(application)}</div>
              <p className="ea-identity-caption">Yours permanently, whatever happens next.</p>
            </div>
            <p className="ea-status-footnote">Joining the waitlist does not create an account or guarantee an invite. Early Access numbers are historical identities, not permissions. Priority Access is a waitlist state, not a product permission.</p>
          </aside>
        </div>
        <ShareCardPanel endpoint="/api/share-cards/applicant" initialCards={shareCards} title="Share your access identity" />
      </main>
    </MarketingPageShell>
  );
}

async function loadStatus(token: string) {
  try { return await createWaitlistService().statusWithReferral(token); } catch { return null; }
}

function StatusUnavailable() {
  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="ea-status-page">
        <div className="ea-status-card">
          <div className="ea-status-chip is-muted"><span className="ea-status-chip-dot" aria-hidden="true" />Early Access</div>
          <h1>Status unavailable.</h1>
          <p className="ea-status-body">Use the private status link from your Wanterest email.</p>
          <a className="dashboard-button dashboard-button-primary ea-submit" href="/waitlist">Back to Early Access</a>
        </div>
      </main>
    </MarketingPageShell>
  );
}
