import type { AccessMode, AccessPolicy, PublicAccessState } from "./access-mode.schemas";

const POLICY_BY_MODE: Record<AccessMode, AccessPolicy> = {
  waitlist: {
    mode: "waitlist",
    waitlistRequestsAllowed: true,
    referralSystemActive: true,
    inviteIssuanceAllowed: false,
    // Existing valid invites are preserved across a mode change. They are
    // never silently invalidated by launch operations.
    inviteAcceptanceAllowed: true,
    publicSignupAllowed: false,
    inviteRequiredForAdmission: true,
  },
  invite_only: {
    mode: "invite_only",
    waitlistRequestsAllowed: true,
    referralSystemActive: true,
    inviteIssuanceAllowed: true,
    inviteAcceptanceAllowed: true,
    publicSignupAllowed: false,
    inviteRequiredForAdmission: true,
  },
  open: {
    mode: "open",
    waitlistRequestsAllowed: false,
    referralSystemActive: false,
    inviteIssuanceAllowed: false,
    inviteAcceptanceAllowed: true,
    publicSignupAllowed: true,
    inviteRequiredForAdmission: false,
  },
};

export function getAccessPolicy(mode: AccessMode): AccessPolicy {
  return { ...POLICY_BY_MODE[mode] };
}
export function isAllowedAccessModeTransition(from: AccessMode, to: AccessMode): boolean {
  if (from === to) return true;
  return (from === "waitlist" && to === "invite_only")
    || (from === "invite_only" && (to === "waitlist" || to === "open"))
    || (from === "open" && to === "invite_only");
}

export type HomepageAccessContext = {
  authenticated?: boolean;
  admitted?: boolean;
  waitlistState?: "submitted" | "verified" | "priority" | "invited";
};

export type HomepageAccessState = PublicAccessState & {
  primaryAction: "REQUEST_ACCESS" | "START_FREE" | "CHECK_EMAIL" | "VIEW_STATUS" | "VIEW_PRIORITY_STATUS" | "ACCEPT_INVITATION" | "OPEN_WANTEREST";
  primaryActionHref: "/waitlist" | "/signup" | "/waitlist/status" | "/invite/complete" | "/app";
};

export function getHomepageAccessState(mode: AccessMode, context: HomepageAccessContext = {}): HomepageAccessState {
  const publicState: PublicAccessState = {
    mode,
    canRequestAccess: mode !== "open",
    canSignUp: mode === "open",
    inviteRequired: mode !== "open",
  };
  if (context.authenticated && context.admitted) return { ...publicState, primaryAction: "OPEN_WANTEREST", primaryActionHref: "/app" };
  if (context.waitlistState === "invited") return { ...publicState, primaryAction: "ACCEPT_INVITATION", primaryActionHref: "/invite/complete" };
  if (context.waitlistState === "priority") return { ...publicState, primaryAction: "VIEW_PRIORITY_STATUS", primaryActionHref: "/waitlist/status" };
  if (context.waitlistState === "verified") return { ...publicState, primaryAction: "VIEW_STATUS", primaryActionHref: "/waitlist/status" };
  if (context.waitlistState === "submitted") return { ...publicState, primaryAction: "CHECK_EMAIL", primaryActionHref: "/waitlist/status" };
  return mode === "open"
    ? { ...publicState, primaryAction: "START_FREE", primaryActionHref: "/signup" }
    : { ...publicState, primaryAction: "REQUEST_ACCESS", primaryActionHref: "/waitlist" };
}
