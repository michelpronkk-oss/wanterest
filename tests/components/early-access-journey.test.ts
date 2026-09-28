import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cohortIdentityLabel,
  describeStatus,
  earlyAccessLabel,
  resolveCheckEmailState,
  resolveReveal,
  type JourneyAdmission,
  type JourneyApplication,
  type JourneyReferral,
} from "../../src/components/waitlist/journey";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = new Date("2026-10-03T12:00:00.000Z");

function app(overrides: Partial<JourneyApplication> = {}): JourneyApplication {
  return { status: "verified", earlyAccessNumber: 312, email: "maya@northwind.io", companyName: "Northwind", createdAt: "2026-09-27T09:00:00.000Z", verifiedAt: "2026-09-27T09:05:00.000Z", marketingConsent: false, ...overrides };
}
function referral(overrides: Partial<JourneyReferral> = {}): JourneyReferral {
  return { priorityStatus: "normal", priorityUnlocked: false, priorityGrantedAt: null, verifiedCount: 1, threshold: 3, remainingCount: 2, shareUrl: "https://www.wanterest.com/r/abc", ...overrides };
}
function admission(overrides: Partial<JourneyAdmission> = {}): JourneyAdmission {
  return { inviteStatus: null, inviteExpiresAt: null, admissionStatus: "not_admitted", cohort: null, cohortNumber: null, displayIdentity: null, admittedAt: null, ...overrides };
}

describe("Early Access identity is the authoritative number, never an example or a cohort", () => {
  it("formats the database number and never invents one", () => {
    expect(earlyAccessLabel(312)).toBe("#0312");
    expect(earlyAccessLabel(null)).toBeNull();
  });

  it("shows a cohort identity only after authoritative admission", () => {
    expect(cohortIdentityLabel(admission({ cohort: "founding_25", cohortNumber: 7 }))).toBeNull();
    expect(cohortIdentityLabel(admission({ admissionStatus: "admitted", cohort: "founding_25", cohortNumber: 7 }))).toBe("Founding 25 · #07");
    expect(cohortIdentityLabel(admission({ admissionStatus: "admitted", cohort: "early_100", cohortNumber: 42 }))).toBe("Early 100 · #042");
  });
});

describe("design 05 reveal routing", () => {
  it("reveals a verified application with its real number, company and dates", () => {
    const result = resolveReveal(app(), referral(), admission(), NOW);
    expect(result).toEqual({ kind: "reveal", model: { earlyAccess: "#0312", joined: "27 Sep 2026", company: "Northwind", statusLabel: "Verified", statusTone: "verified" } });
  });

  it("keeps the reveal available to a returning applicant in later states, labelled with the real state", () => {
    expect(resolveReveal(app({ status: "under_review" }), referral(), admission(), NOW)).toMatchObject({ kind: "reveal", model: { statusLabel: "Under review" } });
    expect(resolveReveal(app(), referral({ priorityUnlocked: true, priorityStatus: "granted" }), admission(), NOW)).toMatchObject({ kind: "reveal", model: { statusLabel: "Priority access" } });
  });

  it("never reveals before verification, and sends closed or admitted requests to status", () => {
    expect(resolveReveal(app({ status: "pending", earlyAccessNumber: null, verifiedAt: null }), null, null, NOW)).toEqual({ kind: "redirect", to: "/waitlist/check-email" });
    expect(resolveReveal(app({ status: "withdrawn" }), null, null, NOW)).toEqual({ kind: "redirect", to: "/waitlist/status" });
    expect(resolveReveal(app({ status: "declined" }), null, null, NOW)).toEqual({ kind: "redirect", to: "/waitlist/status" });
    expect(resolveReveal(app({ status: "approved_for_invite" }), null, admission({ admissionStatus: "admitted" }), NOW)).toEqual({ kind: "redirect", to: "/waitlist/status" });
  });
});

describe("design 07/08 status variants map to the six real statuses", () => {
  it("renders a distinct chip, heading and ledger for each status", () => {
    const views = (["pending", "verified", "under_review", "approved_for_invite", "declined", "withdrawn"] as const).map((status) => describeStatus(app({ status }), null, null, NOW));
    expect(new Set(views.map((view) => view.title)).size).toBe(6);
    expect(views.map((view) => view.chip.label)).toEqual(["Pending", "Verified", "Under review", "Approved", "Not selected", "Withdrawn"]);
    for (const view of views) expect(view.ledger.map((node) => node.label)).toHaveLength(4);
  });

  it("uses real timestamps in the ledger and never manufactures progress", () => {
    const verified = describeStatus(app(), null, null, NOW);
    expect(verified.ledger).toEqual([
      { label: "Requested", tone: "done", meta: "27 Sep" },
      { label: "Verified", tone: "done", meta: "27 Sep" },
      { label: "Review", tone: "now", meta: "Soon" },
      { label: "Invite", tone: "next", meta: "Not yet" },
    ]);
    const withdrawn = describeStatus(app({ status: "withdrawn" }), null, null, NOW);
    expect(withdrawn.ledger.slice(2).map((node) => node.tone)).toEqual(["off", "off"]);
    expect(withdrawn.canWithdraw).toBe(false);
  });

  it("does not offer withdrawal for a declined or withdrawn request", () => {
    expect(describeStatus(app({ status: "declined" }), null, null, NOW).canWithdraw).toBe(false);
    expect(describeStatus(app({ status: "under_review" }), null, null, NOW).canWithdraw).toBe(true);
  });
});

describe("design 09 Priority is an overlay grant, never a seventh status", () => {
  it("overlays an active grant on verified and under-review requests", () => {
    for (const status of ["verified", "under_review"] as const) {
      const view = describeStatus(app({ status }), referral({ priorityUnlocked: true, priorityStatus: "granted", priorityGrantedAt: "2026-10-01T00:00:00.000Z" }), null, NOW);
      expect(view.variant).toBe("priority");
      expect(view.chip.label).toBe("Priority access");
      expect(view.priority).toEqual({ since: "1 Oct 2026" });
      expect(view.ledger[2]).toMatchObject({ label: "Priority", tone: "now" });
      expect(view.body).not.toMatch(/position|guarantee|days/i);
    }
  });

  it("drops the Priority experience when the grant is revoked, and hides referral progress", () => {
    const view = describeStatus(app(), referral({ priorityUnlocked: false, priorityStatus: "revoked", verifiedCount: 3, remainingCount: 0 }), null, NOW);
    expect(view.variant).toBe("standard");
    expect(view.chip.label).toBe("Verified");
    expect(view.showReferralProgress).toBe(false);
  });

  it("shows referral progress only for a normal (not yet granted) verified request with a share link", () => {
    expect(describeStatus(app(), referral(), null, NOW).showReferralProgress).toBe(true);
    expect(describeStatus(app(), referral({ shareUrl: null }), null, NOW).showReferralProgress).toBe(false);
  });

  it("never lets Priority outrank a real invite or admission", () => {
    const granted = referral({ priorityUnlocked: true, priorityStatus: "granted" });
    expect(describeStatus(app({ status: "approved_for_invite" }), granted, admission({ inviteStatus: "issued", inviteExpiresAt: "2026-10-08T12:00:00.000Z" }), NOW).variant).toBe("invite");
    expect(describeStatus(app({ status: "declined" }), granted, null, NOW).variant).toBe("standard");
  });
});

describe("design 10 invitation state comes from the private status record", () => {
  it("shows real invite details and remaining days for an issued invite", () => {
    const view = describeStatus(app({ status: "approved_for_invite" }), null, admission({ inviteStatus: "issued", inviteExpiresAt: "2026-10-08T12:00:00.000Z" }), NOW);
    expect(view.variant).toBe("invite");
    expect(view.invite).toEqual({ email: "maya@northwind.io", company: "Northwind", expiresAt: "8 Oct 2026", daysRemaining: 5, earlyAccess: "#0312" });
    expect(view.admitted).toBeUndefined();
  });

  it("treats an issued invite past its real expiry as expired, with a contact-only recovery", () => {
    const view = describeStatus(app({ status: "approved_for_invite" }), null, admission({ inviteStatus: "issued", inviteExpiresAt: "2026-10-01T00:00:00.000Z" }), NOW);
    expect(view.chip.label).toBe("Invite expired");
    expect(view.contactAction?.reason).toBe("invite_expired");
    expect(view.invite).toBeUndefined();
  });

  it("does not claim an invite exists when approval has no issued invite yet", () => {
    const view = describeStatus(app({ status: "approved_for_invite" }), null, admission(), NOW);
    expect(view.title).toBe("You're approved for an invite");
    expect(view.ledger[3]).toMatchObject({ tone: "next" });
  });

  it("shows admission and cohort identity only after the admission record says admitted", () => {
    const view = describeStatus(app({ status: "approved_for_invite" }), null, admission({ inviteStatus: "accepted", admissionStatus: "admitted", cohort: "founding_25", cohortNumber: 7, admittedAt: "2026-10-04T00:00:00.000Z" }), NOW);
    expect(view.variant).toBe("admitted");
    expect(view.admitted).toEqual({ identity: "Founding 25 · #07" });
    expect(view.canWithdraw).toBe(false);
  });
});

describe("design 04 check-email state", () => {
  it("never shows a verified applicant as awaiting verification", () => {
    expect(resolveCheckEmailState(null, { email: "maya@northwind.io" })).toBe("already_verified");
    expect(resolveCheckEmailState("Maya@Northwind.io ", { email: "maya@northwind.io" })).toBe("already_verified");
  });

  it("keeps a new request for a different email pending, and has a safe generic fallback", () => {
    expect(resolveCheckEmailState("new@other.io", { email: "maya@northwind.io" })).toBe("pending");
    expect(resolveCheckEmailState("new@other.io", null)).toBe("pending");
    expect(resolveCheckEmailState(null, null)).toBe("generic");
  });
});

describe("check-email survives a refresh without a server session or PII in the URL", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("stores the submitted payload in sessionStorage and reads it back after a reload", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) });
    const first = await import("../../src/components/waitlist/check-email-storage");
    first.storePendingSubmission("maya@northwind.io", { email: "maya@northwind.io", firstName: "Maya" });

    vi.resetModules(); // a page reload: fresh module state, same tab storage
    const afterReload = await import("../../src/components/waitlist/check-email-storage");
    expect(afterReload.getPendingSubmissionSnapshot()).toEqual({ email: "maya@northwind.io", payload: { email: "maya@northwind.io", firstName: "Maya" } });
    expect(afterReload.getPendingSubmissionSnapshot()).toBe(afterReload.getPendingSubmissionSnapshot());
  });

  it("falls back to nothing (generic screen) when storage is empty or unavailable", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined, removeItem: () => undefined });
    const storage = await import("../../src/components/waitlist/check-email-storage");
    expect(storage.getPendingSubmissionSnapshot()).toBeNull();
  });
});

describe("route-to-component wiring for the complete journey", () => {
  const form = read("src/components/waitlist/waitlist-form.tsx");
  const verifyRoute = read("src/app/waitlist/verify/route.ts");
  const verifiedPage = read("src/app/waitlist/verified/page.tsx");
  const statusPage = read("src/app/waitlist/status/page.tsx");
  const checkEmailPage = read("src/app/waitlist/check-email/page.tsx");
  const views = read("src/components/waitlist/journey-views.tsx");
  const reveal = read("src/components/waitlist/share-my-place.tsx");
  const withdrawButton = read("src/components/waitlist/waitlist-withdraw-button.tsx");

  it("submission → dedicated check-email screen (not a state inside the landing layout)", () => {
    expect(form).toContain('router.push("/waitlist/check-email")');
    expect(form).not.toMatch(/You(&rsquo;|')re on your way/);
    expect(checkEmailPage).toContain("CheckEmailPanel");
    expect(checkEmailPage).not.toContain("MembershipLadder");
  });

  it("verification → /waitlist/verified reveal → View status → /waitlist/status", () => {
    expect(verifyRoute).toContain('"/waitlist/verified"');
    expect(verifiedPage).toContain("resolveReveal");
    expect(verifiedPage).toContain("<VerifiedReveal");
    expect(reveal).toContain('href="/waitlist/status"');
    expect(statusPage).toContain("describeStatus");
    expect(statusPage).toContain("<PrivateStatus");
  });

  it("no longer serves the old generic 'You're on the list' card anywhere in the journey", () => {
    for (const source of [verifiedPage, statusPage, checkEmailPage, views, read("src/app/waitlist/page.tsx"), read("src/components/waitlist/check-email-panel.tsx")]) {
      expect(source).not.toMatch(/on the list/i);
    }
  });

  it("never hardcodes the design's example identity", () => {
    for (const source of [views, verifiedPage, statusPage, read("src/components/waitlist/journey.ts"), read("src/components/waitlist/check-email-panel.tsx")]) {
      expect(source).not.toContain("0184");
      expect(source).not.toMatch(/FOUNDING 07|#07\b/);
    }
  });

  it("keeps private-status credentials cookie-only and actions on /waitlist paths", () => {
    expect(statusPage).toContain("WAITLIST_STATUS_COOKIE");
    expect(statusPage).not.toContain("searchParams");
    expect(verifiedPage).not.toContain("searchParams");
    expect(withdrawButton).toContain('"/waitlist/withdraw"');
    expect(withdrawButton).not.toContain("token");
    expect(reveal).toContain('"/waitlist/share-cards"');
  });

  it("shares only through the existing 13B.1 panel, which publishes on explicit action", () => {
    expect(reveal).toContain("ShareCardPanel");
    expect(verifiedPage).not.toMatch(/mutateApplicantShareCardCommand|publishApplicant/);
    expect(statusPage).not.toMatch(/mutateApplicantShareCardCommand|publishApplicant/);
  });
});
