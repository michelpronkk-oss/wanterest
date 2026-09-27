import { describe, expect, it } from "vitest";

import { priorityReadModel, priorityReferralPolicy } from "../../src/server/modules/waitlist/referral.policy";

describe("priority referral policy", () => {
  it("keeps the categorical threshold and progress truthful", () => {
    expect(priorityReferralPolicy).toEqual({ policyKey: "priority_referral_v1", threshold: 3 });
    expect(priorityReadModel({ verifiedCount: 0, priorityStatus: "normal", priorityGrantedAt: null }, "https://wanterest.com/r/code")).toMatchObject({ verifiedCount: 0, threshold: 3, remainingCount: 3, priorityUnlocked: false });
    expect(priorityReadModel({ verifiedCount: 3, priorityStatus: "granted", priorityGrantedAt: "2026-09-27T00:00:00.000Z" }, "https://wanterest.com/r/code")).toMatchObject({ remainingCount: 0, priorityUnlocked: true, priorityStatus: "granted" });
    expect(priorityReadModel({ verifiedCount: 3, priorityStatus: "revoked", priorityGrantedAt: "2026-09-27T00:00:00.000Z" }, "https://wanterest.com/r/code")).toMatchObject({ remainingCount: 0, priorityUnlocked: false, priorityStatus: "revoked" });
  });
});
