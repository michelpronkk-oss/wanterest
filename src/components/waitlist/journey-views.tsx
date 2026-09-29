import type { ReactNode } from "react";

import Link from "next/link";
import { LogoMark } from "@/components/dashboard/nav-icons";
import { APP_LOGIN_URL } from "@/components/marketing/links";
import { SUPPORT_EMAIL } from "@/shared/config/site";
import { CohortBadge, EarlyAccessNumber, PriorityPill } from "@/components/members/member-identity-slots";
import type { ChipTone, LedgerNode, RevealModel, StatusView } from "./journey";

/**
 * Synchronous, data-in/markup-out views for the Early Access journey. Pages load authoritative
 * state and pick a view; nothing here fetches, so every screen can also be rendered in a real
 * browser from fixtures without touching any database.
 */

const SHELL_NAV_LINKS = [
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

/**
 * `nav="marketing"` (designs 04 and 05): public nav links and "Member log in", no CTA — the
 * applicant is already in the flow. Without it (designs 07–10) the header carries the private
 * status indicator instead.
 */
export function JourneyShell({ indicator, mobileBadge, nav, children }: { indicator?: string; mobileBadge?: ReactNode; nav?: "marketing"; children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="marketing-page ea-shell">
      <header className={`ea-shell-header${nav ? " is-marketing" : ""}`}>
        <Link href="/" className="ea-shell-logo" aria-label="Wanterest home"><LogoMark size={20} /><span>wanterest</span></Link>
        {nav ? (
          <>
            <nav className="ea-shell-links" aria-label="Main">
              {SHELL_NAV_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
            </nav>
            <a className="ea-shell-login" href={APP_LOGIN_URL}>Member log in</a>
          </>
        ) : null}
        {indicator ? <span className="ea-shell-indicator"><span className="ea-shell-indicator-dot" aria-hidden="true" />{indicator}</span> : null}
        {mobileBadge ? <span className={`ea-shell-badge${typeof mobileBadge === "string" ? "" : " is-node"}`}>{mobileBadge}</span> : null}
      </header>
      {children}
      <footer className="ea-shell-footer">
        <span>© {year} Wanterest</span>
        <nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></nav>
      </footer>
    </div>
  );
}
export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  return <span className={`ea-status-chip is-${tone}`}><span className="ea-status-chip-dot" aria-hidden="true" />{label}</span>;
}

type NoticeTone = "positive" | "warning" | "neutral" | "error";

/** Design 14: dot + title + body + text action. Tone by dot, never colour alone; errors are the only filled background. */
export function StatusNotice({ tone, title, body, action }: { tone: NoticeTone; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className={`ea-notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="ea-notice-dot" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {action ? <div className="ea-notice-action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Ledger({ nodes }: { nodes: LedgerNode[] }) {
  return (
    <ol className="ea-ledger" aria-label="Application progress">
      {nodes.map((node, index) => (
        <li key={node.label} className={`ea-ledger-node is-${node.tone}`}>
          <span className={`ea-ledger-dot is-${node.tone}`} aria-hidden="true" />
          <span className="ea-ledger-label">{node.label}</span>
          <span className="ea-ledger-meta">{node.meta}</span>
          {index < nodes.length - 1 ? <span className={`ea-ledger-line${node.tone === "done" ? " is-done" : ""}`} aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

function ConfirmedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="#111110" />
      <polyline points="3.8,7.2 6,9.3 10.2,4.9" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Design 05 + 06: the post-verification identity reveal. The number is the authoritative one passed in. */
export function VerifiedReveal({ model, actions }: { model: RevealModel; actions: ReactNode }) {
  return (
    <main className="ea-reveal-page" aria-labelledby="reveal-title">
      <div className="ea-reveal">
        <div className="ea-reveal-confirmed"><ConfirmedIcon />Email confirmed</div>
        <h1 id="reveal-title">You&rsquo;re verified.</h1>
        <p className="ea-reveal-body">Your place is recorded. <span className="ea-hide-mobile">We review requests and open access in waves.</span><span className="ea-show-mobile">Access opens in waves.</span></p>
        <section className="ea-identity-card is-reveal" aria-label="Your Early Access identity">
          <div className="ea-identity-head ea-reveal-label"><span>Early access</span><span className="ea-identity-permanent">Permanent</span></div>
          <div className="ea-identity-number ea-reveal-number"><EarlyAccessNumber label={model.earlyAccess} /></div>
          <dl className="ea-identity-meta ea-reveal-meta">
            <div><dt>Joined</dt><dd>{model.joined}</dd></div>
            <div><dt>Company</dt><dd>{model.company}</dd></div>
            <div><dt>Status</dt><dd><span className={`ea-identity-status-dot is-${model.statusTone}`} aria-hidden="true" />{model.statusLabel}</dd></div>
          </dl>
        </section>
        {actions}
        <div className="ea-next-steps">
          <div className="ea-next-steps-label">What can happen next</div>
          <div className="ea-next-steps-row">
            <span className="ea-next-chip"><span className="ea-next-chip-dot" aria-hidden="true" />Priority access</span>
            <span className="ea-next-arrow" aria-hidden="true">→</span>
            <strong>Invite</strong>
            <span className="ea-next-arrow" aria-hidden="true">→</span>
            <span className="ea-next-muted">Workspace, and a cohort if one is open</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function IdentitySide({ earlyAccess, chip }: { earlyAccess: string; chip: { label: string; tone: ChipTone } }) {
  return (
    <aside className="ea-status-side">
      <div className="ea-identity-card is-compact">
        <div className="ea-identity-head"><span>Early access</span><StatusChip label={chip.label} tone={chip.tone} /></div>
        <div className="ea-identity-number"><EarlyAccessNumber label={earlyAccess} /></div>
        <p className="ea-identity-caption">Yours permanently, whatever happens next.</p>
      </div>
      <p className="ea-status-footnote">Joining the waitlist does not create an account or guarantee an invite.</p>
    </aside>
  );
}

function StatusDetails({ submitted, company, email, marketingConsent }: { submitted: string; company: string; email: string; marketingConsent: boolean }) {
  return (
    <dl className="ea-status-details">
      <div><dt>Submitted</dt><dd>{submitted}</dd></div>
      <div><dt>Company</dt><dd>{company}</dd></div>
      <div className="ea-hide-mobile"><dt>Email</dt><dd>{email}</dd></div>
      <div className="ea-hide-mobile"><dt>Product updates</dt><dd>{marketingConsent ? "Subscribed" : "Not subscribed"}</dd></div>
    </dl>
  );
}

function PriorityCard({ earlyAccess, earlyAccessNumber, since }: { earlyAccess: string; earlyAccessNumber: number | null; since: string | null }) {
  return (
    <section className="ea-priority-card" aria-label="Priority Access">
      <div className="ea-priority-band">
        <div><span className="ea-priority-kicker">Status</span><strong>Priority access</strong></div>
        <span className="ea-priority-band-meta">
          <PriorityPill status="granted" earlyAccessNumber={earlyAccessNumber} />
          {since ? <span className="ea-priority-since">Since {since}</span> : null}
        </span>
      </div>
      <div className="ea-priority-number-row">
        <div><span className="ea-priority-kicker is-muted">Early access</span><span className="ea-priority-number"><EarlyAccessNumber label={earlyAccess} /></span></div>
        <span className="ea-priority-note">Your original number is kept.</span>
      </div>
    </section>
  );
}

/** Design 10: invite details from the private status record. Acceptance stays in the emailed link (server-held token). */
function InviteCard({ invite }: { invite: NonNullable<StatusView["invite"]> }) {
  return (
    <section className="ea-invite-card" aria-label="Your invitation">
      <dl className="ea-invite-grid">
        <div><dt>Invited</dt><dd>{invite.email}</dd></div>
        <div><dt>Company</dt><dd>{invite.company}</dd></div>
        <div><dt>Expires</dt><dd>{invite.expiresAt} · {invite.daysRemaining === 1 ? "1 day" : `${invite.daysRemaining} days`}</dd></div>
        <div><dt>Early access</dt><dd>{invite.earlyAccess}</dd></div>
      </dl>
      <p className="ea-invite-note">For your security, the acceptance link lives only in the invitation email. Open it on this device to create your workspace.</p>
    </section>
  );
}

export function CohortPreview() {
  return (
    <aside className="ea-cohort-preview" aria-label="Cohort preview">
      <div className="ea-cohort-kicker">COHORT</div>
      <strong>Assigned when your workspace is created</strong>
      <p>If a founding cohort is still open, you may join it:</p>
      <div className="ea-cohort-badges">
        <CohortBadge cohort="founding_25" />
        <CohortBadge cohort="early_100" />
      </div>
      <p className="ea-cohort-footnote">Preview only. An invite is not a cohort.</p>
    </aside>
  );
}

export function ReferralProgress({ verifiedCount, threshold, copyButton }: { verifiedCount: number; threshold: number; copyButton: ReactNode }) {
  return (
    <section className="ea-referral" aria-label="Priority Access referrals">
      <div className="ea-referral-head">
        <strong>Move your request forward</strong>
        <span>{verifiedCount} of {threshold}</span>
      </div>
      <p>When {threshold} people you invite verify their own request, your request moves to Priority Access. Priority is earlier review, not an invite.</p>
      {copyButton}
    </section>
  );
}

export function PrivateStatus({ view, earlyAccess, earlyAccessNumber = null, details, withdraw, referral, share }: {
  view: StatusView;
  earlyAccess: string;
  earlyAccessNumber?: number | null;
  details: { submitted: string; company: string; email: string; marketingConsent: boolean };
  withdraw?: ReactNode;
  referral?: ReactNode;
  share?: ReactNode;
}) {
  const contact = view.contactAction ? <a className="ea-text-action" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(view.contactAction.reason === "invite_expired" ? "New Wanterest invite" : "Wanterest invitation")}`}>{view.contactAction.label}</a> : null;
  const sidebar = view.variant === "invite" ? <CohortPreview /> : view.variant === "priority" ? null : <IdentitySide earlyAccess={earlyAccess} chip={view.chip} />;

  return (
    <main className="ea-status-page" aria-labelledby="status-title">
      <div className={`ea-status-grid${sidebar ? "" : " is-single"}`}>
        <div className="ea-status-main">
          <StatusChip label={view.chip.label} tone={view.chip.tone} />
          <h1 id="status-title">{view.title}</h1>
          <p className="ea-status-body">{view.body}</p>
          {view.variant === "priority" ? <PriorityCard earlyAccess={earlyAccess} earlyAccessNumber={earlyAccessNumber} since={view.priority?.since ?? null} /> : null}
          {view.variant === "invite" && view.invite ? <InviteCard invite={view.invite} /> : null}
          {view.variant === "admitted" && view.admitted?.cohort ? <p className="ea-admitted-identity"><span>Cohort identity</span><CohortBadge cohort={view.admitted.cohort.cohort} number={view.admitted.cohort.number} /></p> : view.variant === "admitted" && view.admitted?.identity ? <p className="ea-admitted-identity"><span>Cohort identity</span><strong>{view.admitted.identity}</strong></p> : null}
          <Ledger nodes={view.ledger} />
          {contact ? <div className="ea-status-actions">{contact}</div> : null}
          {view.showReferralProgress ? referral : null}
          <StatusDetails {...details} />
          {view.canWithdraw && withdraw ? <div className="ea-status-actions">{withdraw}</div> : null}
        </div>
        {sidebar}
      </div>
      {share}
    </main>
  );
}

/** Design 08 "Link expired" / invalid private link. The honest recovery is the original confirmation email: its link re-opens status for a verified request. */
export function StatusUnavailableView() {
  return (
    <main className="ea-status-page" aria-labelledby="status-title">
      <div className="ea-status-card">
        <StatusChip label="Private link" tone="warning" />
        <h1 id="status-title">We can&rsquo;t open your status here.</h1>
        <p className="ea-status-body">Your private status link lives in the browser where you confirmed your email, for 30 days. To open it again, click the link in your Wanterest confirmation email — it works even if you already confirmed.</p>
        <div className="ea-status-actions"><a className="dashboard-button dashboard-button-secondary" href="/waitlist">Back to Early Access</a></div>
      </div>
    </main>
  );
}

export function LinkUnavailableView({ reason }: { reason: "expired" | "invalid" }) {
  return (
    <main className="ea-status-page" aria-labelledby="link-title">
      <div className="ea-status-card">
        <StatusChip label={reason === "expired" ? "Link expired" : "Link unavailable"} tone="warning" />
        <h1 id="link-title">{reason === "expired" ? "That link has expired." : "That link doesn’t work."}</h1>
        <p className="ea-status-body">{reason === "expired"
          ? "Confirmation links last 48 hours. Request access again with the same work email and we'll send a fresh link — your request isn't duplicated."
          : "It may have been copied incompletely, or replaced by a newer link. If you requested access more than once, use the most recent email."}</p>
        <div className="ea-status-actions"><a className="dashboard-button dashboard-button-primary" href="/waitlist">{reason === "expired" ? "Send a new link" : "Back to Early Access"}</a></div>
      </div>
    </main>
  );
}
