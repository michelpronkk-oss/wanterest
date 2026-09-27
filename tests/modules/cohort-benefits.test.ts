import { describe, expect, it } from "vitest";

import { BillingService } from "../../src/server/modules/billing/billing.service";
import { InMemoryBillingRepository } from "../../src/server/modules/billing/billing.repository";
import { createDodoProductCatalog } from "../../src/server/modules/billing/product-mapping";
import { FixtureBillingProvider } from "../../src/server/providers/billing/fixture";
import { cohortBenefitPolicies } from "../../src/server/modules/cohort-benefits/cohort-benefit.policies";
import { effectiveCohortBenefitStatus } from "../../src/server/modules/cohort-benefits/cohort-benefit.schemas";

const workspaceId = "00000000-0000-4000-8000-000000000001";

describe("13A.2B cohort benefits", () => {
  it("keeps policy terms versioned and separate from cohort identity", () => {
    expect(cohortBenefitPolicies.founding_25_v1).toMatchObject({ discountPercent: 30, durationMonths: 24, activationTrigger: "first_paid_subscription" });
    expect(cohortBenefitPolicies.early_100_v1).toMatchObject({ discountPercent: 15, durationMonths: 12, activationTrigger: "first_paid_subscription" });
  });

  it("uses calendar expiry state without mutating stored history during reads", () => {
    expect(effectiveCohortBenefitStatus("active", "2026-09-01T00:00:00.000Z", new Date("2026-09-01T00:00:00.000Z"))).toBe("expired");
    expect(effectiveCohortBenefitStatus("active", "2026-10-01T00:00:00.000Z", new Date("2026-09-30T23:59:59.000Z"))).toBe("active");
    expect(effectiveCohortBenefitStatus("revoked", null)).toBe("revoked");
  });

  it("connects billing only at normalized active paid state", async () => {
    const repository = new InMemoryBillingRepository();
    const provider = new FixtureBillingProvider(createDodoProductCatalog({ proMonthly: "pro-monthly", proAnnual: "pro-annual", growthMonthly: "growth-monthly", growthAnnual: "growth-annual" }));
    const calls: string[] = [];
    provider.seedSubscription({ providerSubscriptionId: "sub-benefit", providerCustomerId: "cus-benefit", internalPlan: "pro", billingInterval: "monthly" });
    const billing = new BillingService(repository, provider, createDodoProductCatalog({ proMonthly: "pro-monthly", proAnnual: "pro-annual", growthMonthly: "growth-monthly", growthAnnual: "growth-annual" }), undefined, {
      activateFromSuccessfulPaidSubscription: async (input) => { calls.push(input.providerEventId); return { status: "activated" }; },
    });
    const active = await provider.emit("sub-benefit", "active");
    await billing.processVerifiedEvent(workspaceId, active);
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-benefit", "past_due"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(active.providerEventId);
  });
});
