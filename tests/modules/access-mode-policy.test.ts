import { describe, expect, it } from "vitest";

import { getAccessPolicy, getHomepageAccessState, isAllowedAccessModeTransition } from "../../src/server/modules/access";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("13A.6 access-mode policy", () => {
  it("derives one truthful policy for each launch mode", () => {
    expect(getAccessPolicy("waitlist")).toMatchObject({ waitlistRequestsAllowed: true, referralSystemActive: true, inviteIssuanceAllowed: false, publicSignupAllowed: false, inviteRequiredForAdmission: true });
    expect(getAccessPolicy("invite_only")).toMatchObject({ waitlistRequestsAllowed: true, referralSystemActive: true, inviteIssuanceAllowed: true, publicSignupAllowed: false, inviteRequiredForAdmission: true });
    expect(getAccessPolicy("open")).toMatchObject({ waitlistRequestsAllowed: false, referralSystemActive: false, inviteAcceptanceAllowed: true, publicSignupAllowed: true, inviteRequiredForAdmission: false });
  });

  it("allows normal launch and emergency rollback transitions only", () => {
    expect(isAllowedAccessModeTransition("waitlist", "invite_only")).toBe(true);
    expect(isAllowedAccessModeTransition("invite_only", "open")).toBe(true);
    expect(isAllowedAccessModeTransition("open", "invite_only")).toBe(true);
    expect(isAllowedAccessModeTransition("waitlist", "open")).toBe(false);
    expect(isAllowedAccessModeTransition("open", "waitlist")).toBe(false);
  });

  it("keeps header and hero on the same visitor action", () => {
    expect(getHomepageAccessState("invite_only").primaryAction).toBe("REQUEST_ACCESS");
    expect(getHomepageAccessState("open").primaryAction).toBe("START_FREE");
    expect(getHomepageAccessState("open", { authenticated: true, admitted: true })).toEqual(expect.objectContaining({ primaryAction: "OPEN_WANTEREST", primaryActionHref: "/app" }));
    expect(getHomepageAccessState("invite_only", { waitlistState: "priority" }).primaryAction).toBe("VIEW_PRIORITY_STATUS");
  });
});
