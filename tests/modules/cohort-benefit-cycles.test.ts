import { describe, expect, it } from "vitest";

import { getRemainingEligibleDiscountCycles, initialDiscountCycles } from "../../src/server/modules/cohort-benefits/cohort-benefit.cycles";

describe("13A.2B provider billing-cycle enforcement", () => {
  it("maps the two product policies to exact monthly and annual provider cycle limits", () => {
    expect(initialDiscountCycles(24, "monthly")).toBe(24);
    expect(initialDiscountCycles(24, "annual")).toBe(2);
    expect(initialDiscountCycles(12, "monthly")).toBe(12);
    expect(initialDiscountCycles(12, "annual")).toBe(1);
  });

  it("counts future billing anchors before the original calendar expiry", () => {
    expect(getRemainingEligibleDiscountCycles({
      activatedAt: "2027-01-01T00:00:00.000Z",
      expiresAt: "2029-01-01T00:00:00.000Z",
      now: "2027-07-01T00:00:00.000Z",
      nextBillingAt: "2027-08-01T00:00:00.000Z",
      billingInterval: "monthly",
    })).toBe(17);

    expect(getRemainingEligibleDiscountCycles({
      activatedAt: "2027-01-01T00:00:00.000Z",
      expiresAt: "2029-01-01T00:00:00.000Z",
      now: "2027-07-01T00:00:00.000Z",
      nextBillingAt: "2027-08-01T00:00:00.000Z",
      billingInterval: "annual",
    })).toBe(2);
  });

  it("uses the original expiry through cancellation/resubscription and returns zero after expiry", () => {
    expect(getRemainingEligibleDiscountCycles({
      activatedAt: "2027-01-01T00:00:00.000Z",
      expiresAt: "2029-01-01T00:00:00.000Z",
      now: "2027-12-01T00:00:00.000Z",
      nextBillingAt: "2028-01-01T00:00:00.000Z",
      billingInterval: "monthly",
    })).toBe(12);
    expect(getRemainingEligibleDiscountCycles({
      activatedAt: "2027-01-01T00:00:00.000Z",
      expiresAt: "2029-01-01T00:00:00.000Z",
      now: "2029-01-01T00:00:00.000Z",
      nextBillingAt: "2029-02-01T00:00:00.000Z",
      billingInterval: "monthly",
    })).toBe(0);
  });
});

