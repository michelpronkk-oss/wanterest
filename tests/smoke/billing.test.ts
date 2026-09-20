import { describe, expect, it } from "vitest";

import { BillingService } from "../../src/server/modules/billing/billing.service";
import { InMemoryBillingRepository } from "../../src/server/modules/billing/billing.repository";
import { createDodoProductCatalog } from "../../src/server/modules/billing/product-mapping";
import { FixtureBillingProvider } from "../../src/server/providers/billing/fixture";

describe("billing fixture smoke", () => {
  it("runs Free -> Pro -> canceling -> Free without granting access from return URLs", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const catalog = createDodoProductCatalog({ proMonthly: "pro-monthly", proAnnual: "pro-annual", growthMonthly: "growth-monthly", growthAnnual: "growth-annual" });
    const repository = new InMemoryBillingRepository();
    const provider = new FixtureBillingProvider(catalog, () => new Date("2026-09-20T12:00:00.000Z"));
    const service = new BillingService(repository, provider, catalog);
    const initial = await service.getBillingOverview(workspaceId);
    const checkout = await service.createCheckout({ workspaceId, plan: "pro", interval: "monthly", returnUrl: "https://app.example.test/success", idempotencyKey: "smoke" });
    provider.seedSubscription({ providerSubscriptionId: "sub-smoke", providerCustomerId: "cus-smoke", internalPlan: "pro", billingInterval: "monthly" });
    await service.processVerifiedEvent(workspaceId, await provider.emit("sub-smoke", "active"));
    const active = await service.getBillingOverview(workspaceId);
    await service.processVerifiedEvent(workspaceId, await provider.emit("sub-smoke", "canceling"));
    const canceling = await service.getBillingOverview(workspaceId);
    await service.processVerifiedEvent(workspaceId, await provider.emit("sub-smoke", "canceled"));
    const ended = await service.getBillingOverview(workspaceId);

    console.log("Initial plan", initial.effectivePlan);
    console.log("Checkout plan", checkout.checkoutReference.includes("checkout") ? "pro" : "unknown");
    console.log("Activated plan", active.effectivePlan);
    console.log("Signal limit", active.entitlements.find((item) => item.capabilityKey === "signals_monthly")?.value);
    console.log("Cancellation state", canceling.subscription?.status);
    console.log("Final plan", ended.effectivePlan);

    expect(initial.effectivePlan).toBe("free");
    expect(active.effectivePlan).toBe("pro");
    expect(canceling.effectivePlan).toBe("pro");
    expect(ended.effectivePlan).toBe("free");
  });
});

