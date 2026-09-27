import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CohortBenefitService } from "../../src/server/modules/cohort-benefits/cohort-benefit.service";
import type { CohortBenefitProviderBinding, CohortBenefitRepository } from "../../src/server/modules/cohort-benefits/cohort-benefit.repository";
import type { CohortBenefitReadModel } from "../../src/server/modules/cohort-benefits/cohort-benefit.schemas";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const entitlementId = "22222222-2222-4222-8222-222222222222";

function model(status: "eligible" | "active" | "expired" | "revoked", overrides: Partial<NonNullable<CohortBenefitReadModel["benefit"]>> = {}): CohortBenefitReadModel {
  return {
    workspaceId,
    membershipId: "33333333-3333-4333-8333-333333333333",
    cohort: "founding_25",
    cohortNumber: 1,
    cohortLimit: 25,
    displayIdentity: "Founding 25",
    benefit: {
      policyKey: "founding_25_v1",
      discountPercent: 30,
      durationMonths: 24,
      status,
      grantedAt: "2027-01-01T00:00:00.000Z",
      activatedAt: status === "eligible" ? null : "2027-01-01T00:00:00.000Z",
      expiresAt: status === "eligible" ? null : "2029-01-01T00:00:00.000Z",
      activationSubscriptionId: status === "eligible" ? null : "44444444-4444-4444-8444-444444444444",
      externalDiscountReference: null,
      providerDiscountStatus: "not_required",
      ...overrides,
    },
  };
}

function repository(readModel: CohortBenefitReadModel, binding: CohortBenefitProviderBinding | null = null) {
  let currentBinding = binding;
  const repo = {
    getReadModel: async () => readModel,
    getEntitlementId: async () => entitlementId,
    grant: async () => ({ entitlementId, status: "eligible", policyKey: "founding_25_v1", created: false }),
    activate: async () => ({ entitlementId, status: "active", activatedAt: "2027-01-01T00:00:00.000Z", expiresAt: "2029-01-01T00:00:00.000Z", changed: false }),
    revoke: async () => ({ entitlementId, status: "revoked", changed: true }),
    getProviderBinding: async () => currentBinding,
    upsertProviderBinding: async (input: Omit<CohortBenefitProviderBinding, "id" | "createdAt" | "supersededAt" | "lastSyncedAt" | "status">) => {
      currentBinding = {
        ...input,
        id: "55555555-5555-4555-8555-555555555555",
        status: "active",
        createdAt: "2027-01-01T00:00:00.000Z",
        supersededAt: null,
        lastSyncedAt: "2027-01-01T00:00:00.000Z",
      };
      return currentBinding;
    },
  } as unknown as CohortBenefitRepository;
  return { repo, getBinding: () => currentBinding };
}

describe("13A.2B provider discount orchestration", () => {
  it("creates an idempotent Founding monthly discount with 30% and 24 cycles", async () => {
    const { repo, getBinding } = repository(model("eligible"));
    const calls: Array<Record<string, unknown>> = [];
    const service = new CohortBenefitService(repo, {
      createDiscount: async (input) => {
        calls.push(input);
        return { providerDiscountId: "dsc_founder", code: "OPAQUE123", amountBasisPoints: input.amountBasisPoints, restrictedTo: input.productIds, subscriptionCycles: input.subscriptionCycles };
      },
    }, () => new Date("2027-01-01T00:00:00.000Z"));

    expect(await service.prepareCheckoutDiscount({ workspaceId, billingInterval: "monthly", productIds: ["pro-m", "pro-y", "growth-m", "growth-y"] })).toBe("OPAQUE123");
    expect(await service.prepareCheckoutDiscount({ workspaceId, billingInterval: "monthly", productIds: ["pro-m", "pro-y", "growth-m", "growth-y"] })).toBe("OPAQUE123");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ amountBasisPoints: 3000, subscriptionCycles: 24, expiresAt: null, idempotencyKey: `wanterest:cohort-benefit:${entitlementId}:monthly:24` });
    expect(getBinding()).toMatchObject({ billingInterval: "monthly", cycleLimit: 24, discountPercent: 30 });
  });

  it("recalculates annual plan-change cycles from the original expiry", async () => {
    const { repo } = repository(model("active"));
    let request: Record<string, unknown> | undefined;
    const service = new CohortBenefitService(repo, {
      createDiscount: async (input) => {
        request = input;
        return { providerDiscountId: "dsc_annual", code: "OPAQUE456", amountBasisPoints: input.amountBasisPoints, restrictedTo: input.productIds, subscriptionCycles: input.subscriptionCycles };
      },
    }, () => new Date("2027-07-01T00:00:00.000Z"));

    expect(await service.preparePlanChangeDiscount({ workspaceId, billingInterval: "annual", productIds: ["pro-m", "pro-y"], nextBillingAt: "2027-08-01T00:00:00.000Z" })).toEqual(["OPAQUE456"]);
    expect(request).toMatchObject({ amountBasisPoints: 3000, subscriptionCycles: 2, expiresAt: "2029-01-01T00:00:00.000Z" });
  });

  it("does not create provider discounts for expired or revoked benefits", async () => {
    for (const status of ["expired", "revoked"] as const) {
      const { repo } = repository(model(status));
      let calls = 0;
      const service = new CohortBenefitService(repo, { createDiscount: async () => { calls += 1; return { providerDiscountId: "unused", code: "UNUSED", amountBasisPoints: 3000, restrictedTo: [], subscriptionCycles: 1 }; } });
      expect(await service.prepareCheckoutDiscount({ workspaceId, billingInterval: "monthly", productIds: ["pro-m"] })).toBeNull();
      expect(calls).toBe(0);
    }
  });

  it("uses one stable provider idempotency key for concurrent checkout preparation", async () => {
    const { repo } = repository(model("eligible"));
    const keys: string[] = [];
    const service = new CohortBenefitService(repo, {
      createDiscount: async (input) => {
        keys.push(input.idempotencyKey);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { providerDiscountId: "dsc_concurrent", code: "OPAQUE789", amountBasisPoints: input.amountBasisPoints, restrictedTo: input.productIds, subscriptionCycles: input.subscriptionCycles };
      },
    });
    const results = await Promise.all([
      service.prepareCheckoutDiscount({ workspaceId, billingInterval: "monthly", productIds: ["pro-m"] }),
      service.prepareCheckoutDiscount({ workspaceId, billingInterval: "monthly", productIds: ["pro-m"] }),
    ]);
    expect(results).toEqual(["OPAQUE789", "OPAQUE789"]);
    expect(new Set(keys)).toEqual(new Set([`wanterest:cohort-benefit:${entitlementId}:monthly:24`]));
  });
});

