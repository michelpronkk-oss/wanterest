import { describe, expect, it } from "vitest";

import { BillingService } from "../../src/server/modules/billing/billing.service";
import { InMemoryBillingRepository } from "../../src/server/modules/billing/billing.repository";
import { createCheckoutInputSchema } from "../../src/server/modules/billing/billing.schemas";
import { createDodoProductCatalog } from "../../src/server/modules/billing/product-mapping";
import { FixtureBillingProvider, fixtureSecret } from "../../src/server/providers/billing/fixture";
import { DodoBillingProvider, signDodoWebhook } from "../../src/server/providers/billing/dodo/adapter";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const catalog = createDodoProductCatalog({
  proMonthly: "dodo_pro_monthly",
  proAnnual: "dodo_pro_annual",
  growthMonthly: "dodo_growth_monthly",
  growthAnnual: "dodo_growth_annual",
});

function service(repository = new InMemoryBillingRepository()) {
  const provider = new FixtureBillingProvider(catalog, () => new Date("2026-09-20T12:00:00.000Z"));
  const audits: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  const billing = new BillingService(repository, provider, catalog, async (event) => { audits.push(event); });
  return { repository, provider, billing, audits };
}

describe("Phase 6 billing", () => {
  it("maps only internal Pro/Growth plans to provider products and deduplicates checkout", async () => {
    const { billing, provider } = service();
    const first = await billing.createCheckout({ workspaceId, plan: "pro", interval: "monthly", idempotencyKey: "retry-1" });
    const second = await billing.createCheckout({ workspaceId, plan: "pro", interval: "monthly", idempotencyKey: "retry-1" });
    expect(first).toEqual(second);
    expect([...provider.checkouts.values()][0]?.checkoutUrl).toContain(encodeURIComponent(first.checkoutReference));
    await billing.createCheckout({ workspaceId, plan: "pro", interval: "annual", idempotencyKey: "retry-2" });
    await billing.createCheckout({ workspaceId, plan: "growth", interval: "monthly", idempotencyKey: "retry-3" });
    await billing.createCheckout({ workspaceId, plan: "growth", interval: "annual", idempotencyKey: "retry-4" });
    expect([...provider.checkoutInputs.values()].map((input) => input.providerProductId)).toEqual(expect.arrayContaining([
      "dodo_pro_monthly", "dodo_pro_annual", "dodo_growth_monthly", "dodo_growth_annual",
    ]));
    expect(createCheckoutInputSchema.safeParse({ workspaceId, plan: "free", interval: "monthly" }).success).toBe(false);
    const parsed = createCheckoutInputSchema.safeParse({ workspaceId, plan: "pro", interval: "monthly", product_id: "attacker-price" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "product_id" in parsed.data).toBe(false);
  });

  it("rejects invalid webhook signatures before payload parsing", async () => {
    const provider = new DodoBillingProvider({ apiKey: "test", webhookSecret: fixtureSecret, baseUrl: "https://fixture.invalid", catalog, clock: () => new Date("2026-09-20T12:00:00.000Z") });
    const body = JSON.stringify({ type: "subscription.active", data: {} });
    const timestamp = Math.floor(Date.parse("2026-09-20T12:00:00.000Z") / 1000);
    const headers = { "webhook-id": "evt-1", "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(body, "evt-1", timestamp, fixtureSecret) };
    await expect(provider.verifyWebhook(body, headers, new Date(timestamp * 1000))).rejects.toThrow("missing");
    const validBody = JSON.stringify({ type: "subscription.active", data: { subscription_id: "sub-1", customer_id: "cus-1", product_id: "dodo_pro_monthly", status: "active" } });
    const validHeaders = { "webhook-id": "evt-2", "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(validBody, "evt-2", timestamp, fixtureSecret) };
    await expect(provider.verifyWebhook(validBody, validHeaders, new Date(timestamp * 1000))).resolves.toMatchObject({ providerEventId: "evt-2" });
    await expect(provider.verifyWebhook(validBody, { ...validHeaders, "webhook-signature": "v1,invalid" }, new Date(timestamp * 1000))).rejects.toThrow("invalid");
  });

  it("uses the verified inbox as the durable duplicate boundary", async () => {
    const { billing, provider, repository } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-inbox", providerCustomerId: "cus-inbox", internalPlan: "pro", billingInterval: "monthly" });
    const verified = await provider.emit("sub-inbox", "active");
    const body = JSON.stringify(verified.payload);
    const timestamp = Math.floor(Date.parse(verified.occurredAt) / 1_000);
    const headers = { "webhook-id": verified.providerEventId, "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(body, verified.providerEventId, timestamp, fixtureSecret) };
    const first = await billing.receiveWebhook(body, headers);
    const second = await billing.receiveWebhook(body, headers);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(repository.webhookEvents.size).toBe(1);
  });

  it("keeps Free internal, activates paid entitlements, and preserves usage across plan changes", async () => {
    const { billing, provider, repository } = service();
    const initial = await billing.getBillingOverview(workspaceId);
    expect(initial.effectivePlan).toBe("free");
    expect(initial.entitlements.find((item) => item.capabilityKey === "signals_monthly")?.value).toBe(5);

    provider.seedSubscription({ providerSubscriptionId: "sub-1", providerCustomerId: "cus-1", internalPlan: "pro", billingInterval: "monthly" });
    const active = await provider.emit("sub-1", "active");
    await billing.processVerifiedEvent(workspaceId, active);
    const proOverview = await billing.getBillingOverview(workspaceId);
    expect(proOverview.effectivePlan).toBe("pro");
    expect(proOverview.entitlements.find((item) => item.capabilityKey === "actions_enabled")?.value).toBe(true);
    expect(JSON.stringify(proOverview)).not.toContain("dodo_");

    repository.usage.set(workspaceId, [{ usageType: "qualified_signal", amount: 450 }]);
    const upgraded = await provider.emit("sub-1", "upgrade", { internalPlan: "growth", providerProductId: "dodo_growth_monthly" });
    await billing.processVerifiedEvent(workspaceId, upgraded);
    const overview = await billing.getBillingOverview(workspaceId);
    expect(overview.effectivePlan).toBe("growth");
    expect(overview.entitlements.find((item) => item.capabilityKey === "signals_monthly")?.value).toBe(2000);
    expect(overview.usage).toEqual([{ usageType: "qualified_signal", amount: 450 }]);
  });

  it("preserves paid access for scheduled cancellation and past_due, then falls back to Free", async () => {
    const { billing, provider } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-2", providerCustomerId: "cus-2", internalPlan: "growth", billingInterval: "annual" });
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-2", "active"));
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-2", "canceling"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("growth");
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-2", "past_due"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("growth");
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-2", "canceled"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("free");
    expect((await billing.getBillingOverview(workspaceId)).entitlements.find((item) => item.capabilityKey === "signals_monthly")?.value).toBe(5);
  });

  it("does not let an older provider event overwrite newer normalized state", async () => {
    const { billing, provider } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-3", providerCustomerId: "cus-3", internalPlan: "pro", billingInterval: "monthly" });
    const newer = await provider.emit("sub-3", "upgrade", { internalPlan: "growth", providerProductId: "dodo_growth_monthly", providerUpdatedAt: "2026-09-20T12:05:00.000Z" });
    await billing.processVerifiedEvent(workspaceId, newer);
    const older = await provider.emit("sub-3", "canceled", { providerUpdatedAt: "2026-09-20T12:04:00.000Z" });
    await billing.processVerifiedEvent(workspaceId, older);
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("growth");
  });
});
