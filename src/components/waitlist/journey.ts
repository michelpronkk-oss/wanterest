import type { WaitlistAdmissionStatus, WaitlistApplication, WaitlistReferralReadModel } from "@/server/modules/waitlist";

/**
 * Pure view models for the Early Access journey (design sections 05, 07, 08, 09, 10).
 * Every value is derived from the authoritative application / referral / admission records —
 * no invented queue movement, dates, numbers or cohorts. Priority is an overlay on the real
 * application status (Layer 13A.3 grant), never a seventh status. Kept free of server-only
 * imports (types only) so route wiring and every variant can be unit-tested with fixtures.
 */

export type JourneyApplication = Pick<WaitlistApplication, "status" | "earlyAccessNumber" | "email" | "companyName" | "createdAt" | "verifiedAt" | "marketingConsent">;
export type JourneyReferral = Pick<WaitlistReferralReadModel, "priorityStatus" | "priorityUnlocked" | "priorityGrantedAt" | "verifiedCount" | "threshold" | "remainingCount" | "shareUrl">;
export type JourneyAdmission = Pick<WaitlistAdmissionStatus, "inviteStatus" | "inviteExpiresAt" | "admissionStatus" | "cohort" | "cohortNumber" | "displayIdentity" | "admittedAt">;

export type LedgerTone = "done" | "now" | "next" | "off";
export type LedgerNode = { label: string; tone: LedgerTone; meta: string };
export type ChipTone = "neutral" | "verified" | "priority" | "invite" | "muted" | "warning";

export type StatusVariant = "standard" | "priority" | "invite" | "admitted";

export type StatusView = {
  variant: StatusVariant;
  chip: { label: string; tone: ChipTone };
  title: string;
  body: string;
  ledger: LedgerNode[];
  /** Contact is the only real recovery for an expired/revoked invite: there is no self-serve reissue operation. */
  contactAction?: { label: string; reason: "invite_expired" | "invite_revoked" };
  invite?: { email: string; company: string; expiresAt: string; daysRemaining: number; earlyAccess: string };
  priority?: { since: string | null };
  admitted?: { identity: string | null };
  showReferralProgress: boolean;
  canWithdraw: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic "27 Sep 2026" (design format), independent of the runtime's ICU locale data —
// some ICU versions render en-GB "Sep" as "Sept", and server/client must agree.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function utcParts(iso: string | null | undefined): { day: number; month: string; year: number } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { day: date.getUTCDate(), month: MONTHS[date.getUTCMonth()], year: date.getUTCFullYear() };
}

export function formatJourneyDate(iso: string | null | undefined): string {
  const parts = utcParts(iso);
  return parts ? `${parts.day} ${parts.month} ${parts.year}` : "—";
}

function shortDate(iso: string | null | undefined): string {
  const parts = utcParts(iso);
  return parts ? `${parts.day} ${parts.month}` : "—";
}

/** An Early Access number is a permanent place-in-line identity. It is never a cohort number. */
export function earlyAccessLabel(earlyAccessNumber: number | null | undefined): string | null {
  return earlyAccessNumber ? `#${String(earlyAccessNumber).padStart(4, "0")}` : null;
}

/** Cohort identity exists only after authoritative admission, and only from the admission record. */
export function cohortIdentityLabel(admission: JourneyAdmission | null | undefined): string | null {
  if (admission?.admissionStatus !== "admitted" || !admission.cohort || !admission.cohortNumber) return null;
  const name = admission.cohort === "founding_25" ? "Founding 25" : "Early 100";
  return `${name} · #${String(admission.cohortNumber).padStart(admission.cohort === "founding_25" ? 2 : 3, "0")}`;
}

/** The backend can report an invite as "issued" after its expiry passes; the real timestamp decides. */
export function effectiveInviteStatus(admission: JourneyAdmission | null | undefined, now: Date): JourneyAdmission["inviteStatus"] {
  const status = admission?.inviteStatus ?? null;
  if (status === "issued" && admission?.inviteExpiresAt && new Date(admission.inviteExpiresAt).getTime() <= now.getTime()) return "expired";
  return status;
}

export function describeStatus(application: JourneyApplication, referral: JourneyReferral | null | undefined, admission: JourneyAdmission | null | undefined, now: Date = new Date()): StatusView {
  const priority = referral?.priorityUnlocked === true;
  const number = earlyAccessLabel(application.earlyAccessNumber);
  const reviewLabel = priority ? "Priority" : "Review";
  const requested: LedgerNode = { label: "Requested", tone: "done", meta: shortDate(application.createdAt) };
  const verified = (tone: LedgerTone): LedgerNode => ({ label: "Verified", tone, meta: application.verifiedAt ? shortDate(application.verifiedAt) : "Waiting" });
  const base = { showReferralProgress: false, canWithdraw: application.status !== "withdrawn" && application.status !== "declined" };

  if (admission?.admissionStatus === "admitted") {
    return {
      ...base, variant: "admitted", canWithdraw: false,
      chip: { label: "Admitted", tone: "invite" },
      title: "Your Wanterest access is ready.",
      body: "Your invitation is complete and your workspace has been created.",
      ledger: [requested, verified("done"), { label: reviewLabel, tone: "done", meta: "Reviewed" }, { label: "Invite", tone: "done", meta: shortDate(admission.admittedAt) }],
      admitted: { identity: cohortIdentityLabel(admission) },
    };
  }

  if (application.status === "pending") {
    return {
      ...base, variant: "standard",
      chip: { label: "Pending", tone: "muted" },
      title: "Confirm your email",
      body: `Your place isn't reserved until you open the link we sent to ${application.email}.`,
      ledger: [{ ...requested, tone: "now" }, verified("next"), { label: reviewLabel, tone: "next", meta: "—" }, { label: "Invite", tone: "next", meta: "—" }],
    };
  }

  if (application.status === "declined") {
    return {
      ...base, variant: "standard",
      chip: { label: "Not selected", tone: "muted" },
      title: "Not this round",
      body: "We couldn't offer access this time. Your Early Access number stays yours if we open more places.",
      ledger: [requested, verified("done"), { label: reviewLabel, tone: "done", meta: "Closed" }, { label: "Invite", tone: "off", meta: "—" }],
    };
  }

  if (application.status === "withdrawn") {
    return {
      ...base, variant: "standard",
      chip: { label: "Withdrawn", tone: "muted" },
      title: "Request withdrawn",
      body: `You won't be considered for access. ${number ?? "Your Early Access number"} remains reserved as part of your history.`,
      ledger: [requested, verified("done"), { label: reviewLabel, tone: "off", meta: "—" }, { label: "Invite", tone: "off", meta: "—" }],
    };
  }

  if (application.status === "approved_for_invite") {
    const invite = effectiveInviteStatus(admission, now);
    const reviewed: LedgerNode = { label: reviewLabel, tone: "done", meta: "Reviewed" };
    if (invite === "issued" && admission?.inviteExpiresAt) {
      const daysRemaining = Math.max(0, Math.ceil((new Date(admission.inviteExpiresAt).getTime() - now.getTime()) / DAY_MS));
      return {
        ...base, variant: "invite",
        chip: { label: "Invite ready", tone: "invite" },
        title: "You're invited.",
        body: `Your Wanterest workspace is ready to be created. Accept it from the invitation email we sent to ${application.email}.`,
        ledger: [requested, verified("done"), reviewed, { label: "Invite", tone: "now", meta: "Ready" }],
        invite: { email: application.email, company: application.companyName, expiresAt: formatJourneyDate(admission.inviteExpiresAt), daysRemaining, earlyAccess: number ?? "—" },
      };
    }
    if (invite === "expired") {
      return {
        ...base, variant: "standard",
        chip: { label: "Invite expired", tone: "warning" },
        title: "Invite expired",
        body: "Invites last 7 days. Ask us to reissue it — your Early Access number and review stay as they are.",
        ledger: [requested, verified("done"), reviewed, { label: "Invite", tone: "off", meta: "Expired" }],
        contactAction: { label: "Request a new invite", reason: "invite_expired" },
      };
    }
    if (invite === "revoked") {
      return {
        ...base, variant: "standard",
        chip: { label: "Invite withdrawn", tone: "muted" },
        title: "This invitation is no longer active",
        body: "The invitation sent to you was withdrawn. Your Early Access number stays yours.",
        ledger: [requested, verified("done"), reviewed, { label: "Invite", tone: "off", meta: "—" }],
        contactAction: { label: "Contact us", reason: "invite_revoked" },
      };
    }
    return {
      ...base, variant: "standard",
      chip: { label: "Approved", tone: "verified" },
      title: "You're approved for an invite",
      body: "Invites go out in waves. We'll email you as soon as yours is ready.",
      ledger: [requested, verified("done"), reviewed, { label: "Invite", tone: "next", meta: "Not yet" }],
    };
  }

  if (priority) {
    return {
      ...base, variant: "priority",
      chip: { label: "Priority access", tone: "priority" },
      title: "You're closer to the front.",
      body: "Your request moved forward in review. Invites still go out in waves, and yours is now earlier in the order.",
      ledger: [requested, verified("done"), { label: "Priority", tone: "now", meta: referral?.priorityGrantedAt ? shortDate(referral.priorityGrantedAt) : "Now" }, { label: "Invite", tone: "next", meta: "Not yet" }],
      priority: { since: referral?.priorityGrantedAt ? formatJourneyDate(referral.priorityGrantedAt) : null },
    };
  }

  const showReferralProgress = Boolean(referral?.shareUrl) && referral?.priorityStatus === "normal";

  if (application.status === "under_review") {
    return {
      ...base, variant: "standard", showReferralProgress,
      chip: { label: "Under review", tone: "neutral" },
      title: "We're reviewing your request",
      body: "A person reads every request. Invites go out in waves, so this can take a few weeks.",
      ledger: [requested, verified("done"), { label: reviewLabel, tone: "now", meta: "In progress" }, { label: "Invite", tone: "next", meta: "Not yet" }],
    };
  }

  return {
    ...base, variant: "standard", showReferralProgress,
    chip: { label: "Verified", tone: "verified" },
    title: "You're verified",
    body: `${number ? `Early Access ${number}` : "Your Early Access place"} is recorded. Review starts shortly.`,
    ledger: [requested, verified("done"), { label: reviewLabel, tone: "now", meta: "Soon" }, { label: "Invite", tone: "next", meta: "Not yet" }],
  };
}

/**
 * Design 04 state. An authoritative verified record in this browser wins over a stale
 * sessionStorage "pending" entry for the same email — a verified applicant is never shown as
 * awaiting verification. A pending entry for a *different* email is a new request and stays pending.
 */
export function resolveCheckEmailState(pendingEmail: string | null, verified: { email: string } | null): "pending" | "already_verified" | "generic" {
  if (verified && (!pendingEmail || pendingEmail.trim().toLowerCase() === verified.email.trim().toLowerCase())) return "already_verified";
  if (pendingEmail) return "pending";
  return "generic";
}

export type RevealModel = {
  earlyAccess: string;
  joined: string;
  company: string;
  statusLabel: string;
  statusTone: ChipTone;
};

/**
 * Where a request for the identity reveal (design 05) should go. The reveal only ever renders for
 * a verified application with an allocated number — never before verification, and not for a
 * closed (withdrawn/declined) or already-admitted request, which the status page describes truthfully.
 */
export function resolveReveal(application: JourneyApplication, referral: JourneyReferral | null | undefined, admission: JourneyAdmission | null | undefined, now: Date = new Date()):
  | { kind: "redirect"; to: "/waitlist/status" | "/waitlist/check-email" }
  | { kind: "reveal"; model: RevealModel } {
  if (application.status === "pending" || !application.earlyAccessNumber) return { kind: "redirect", to: "/waitlist/check-email" };
  if (application.status === "withdrawn" || application.status === "declined" || admission?.admissionStatus === "admitted") return { kind: "redirect", to: "/waitlist/status" };
  const view = describeStatus(application, referral, admission, now);
  return {
    kind: "reveal",
    model: {
      earlyAccess: earlyAccessLabel(application.earlyAccessNumber) ?? "—",
      joined: formatJourneyDate(application.verifiedAt ?? application.createdAt),
      company: application.companyName,
      statusLabel: view.chip.label,
      statusTone: view.chip.tone,
    },
  };
}
