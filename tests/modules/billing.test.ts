import { describe, expect, it } from "vitest";

import type { JsonObject } from "../../src/server/db/database.helpers";
import { AppError } from "../../src/server/lib/errors";
import { BillingService } from "../../src/server/modules/billing/billing.service";
import { InMemoryBillingRepository } from "../../src/server/modules/billing/billing.repository";
import { createCheckoutInputSchema } from "../../src/server/modules/billing/billing.schemas";
import { createDodoProductCatalog } from "../../src/server/modules/billing/product-mapping";
import { BillingProviderError } from "../../src/server/providers/billing/contracts";
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
  it("maps every configured Dodo product to one internal plan/cadence and rejects duplicates", () => {
    const mapped = createDodoProductCatalog({
      proMonthly: "pro-m",
      proAnnual: "pro-y",
      growthMonthly: "growth-m",
      growthAnnual: "growth-y",
    });
    expect(mapped.proMonthly).toMatchObject({ internalPlan: "pro", billingInterval: "monthly" });
    expect(mapped.proAnnual).toMatchObject({ internalPlan: "pro", billingInterval: "annual" });
    expect(mapped.growthMonthly).toMatchObject({ internalPlan: "growth", billingInterval: "monthly" });
    expect(mapped.growthAnnual).toMatchObject({ internalPlan: "growth", billingInterval: "annual" });
    expect(() => createDodoProductCatalog({ proMonthly: "same", proAnnual: "same", growthMonthly: "growth-m", growthAnnual: "growth-y" })).toThrow("duplicate");
  });

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
    expect(createCheckoutInputSchema.safeParse({ plan: "pro", cadence: "annual" }).success).toBe(true);
    expect(createCheckoutInputSchema.safeParse({ plan: "pro", cadence: "weekly" }).success).toBe(false);
  });

  it("does not start a second checkout for an already-paid workspace", async () => {
    const { billing, provider, repository } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-paid", providerCustomerId: "cus-paid", internalPlan: "pro", billingInterval: "monthly" });
    const event = await provider.emit("sub-paid", "active");
    await billing.processVerifiedEvent(workspaceId, event);
    await expect(billing.createCheckout({ workspaceId, plan: "growth", interval: "monthly" })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "ACTIVE_SUBSCRIPTION", currentPlan: "pro", upgradeTarget: "growth" },
    });
    expect(repository.checkoutRequests.size).toBe(0);
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

  it("processes current Dodo subscription events from the durable inbox and claims duplicate delivery once", async () => {
    const { billing, provider, repository } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-current-events", providerCustomerId: "cus-current-events", internalPlan: "pro", billingInterval: "monthly" });
    const event = await provider.emit("sub-current-events", "active");
    const payload = JSON.parse(JSON.stringify(event.payload)) as JsonObject;
    (payload.data as JsonObject).metadata = { workspace_id: workspaceId };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.parse(event.occurredAt) / 1_000);
    const headers = { "webhook-id": event.providerEventId, "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(rawBody, event.providerEventId, timestamp, fixtureSecret) };

    const received = await billing.receiveWebhook(rawBody, headers);
    const processed = await billing.processWebhook(received.eventId);
    const duplicate = await billing.receiveWebhook(rawBody, headers);
    const duplicateProcessing = await billing.processWebhook(duplicate.eventId);

    expect(processed.status).toBe("processed");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicateProcessing.status).toBe("already_processed");
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("pro");
    expect(repository.webhookEvents.get(received.eventId)?.attempts).toBe(1);
  });

  it("keeps a scheduled cancellation paid, applies payment failure conservatively, and downgrades only when ended", async () => {
    const { billing, provider } = service();
    provider.seedSubscription({ providerSubscriptionId: "sub-lifecycle", providerCustomerId: "cus-lifecycle", internalPlan: "growth", billingInterval: "annual" });
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-lifecycle", "active"));
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-lifecycle", "canceling"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("growth");
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-lifecycle", "past_due"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("growth");
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-lifecycle", "canceled"));
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("free");
  });

  it("does not activate an unknown product or fail on an unsupported signed event", async () => {
    const provider = new DodoBillingProvider({ apiKey: "test", webhookSecret: fixtureSecret, baseUrl: "https://fixture.invalid", catalog, clock: () => new Date("2026-09-20T12:00:00.000Z") });
    const repository = new InMemoryBillingRepository();
    const billing = new BillingService(repository, provider, catalog);
    const timestamp = Math.floor(Date.parse("2026-09-20T12:00:00.000Z") / 1_000);
    const unknown = JSON.stringify({ type: "subscription.active", timestamp: "2026-09-20T12:00:00.000Z", data: { subscription_id: "sub-unknown", customer_id: "cus-unknown", product_id: "dodo-unknown", metadata: { workspace_id: workspaceId } } });
    const unknownId = "evt-unknown-product";
    const unknownReceived = await billing.receiveWebhook(unknown, { "webhook-id": unknownId, "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(unknown, unknownId, timestamp, fixtureSecret) });
    expect((await billing.processWebhook(unknownReceived.eventId)).status).toBe("ignored");
    expect(repository.subscriptions.size).toBe(0);

    const unsupported = JSON.stringify({ type: "refund.succeeded", timestamp: "2026-09-20T12:00:00.000Z", data: { refund_id: "refund-1" } });
    const unsupportedId = "evt-unsupported";
    const unsupportedReceived = await billing.receiveWebhook(unsupported, { "webhook-id": unsupportedId, "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(unsupported, unsupportedId, timestamp, fixtureSecret) });
    expect((await billing.processWebhook(unsupportedReceived.eventId)).status).toBe("ignored");
  });

  it("leaves unresolved subscriptions retryable and rejects cross-workspace metadata", async () => {
    const { billing, provider, repository } = service();
    const workspaceB = "22222222-2222-4222-8222-222222222222";
    provider.seedSubscription({ providerSubscriptionId: "sub-unresolved", providerCustomerId: "cus-unresolved", internalPlan: "pro", billingInterval: "monthly" });
    const event = await provider.emit("sub-unresolved", "active");
    const rawBody = JSON.stringify(event.payload);
    const timestamp = Math.floor(Date.parse(event.occurredAt) / 1_000);
    const headers = { "webhook-id": event.providerEventId, "webhook-timestamp": String(timestamp), "webhook-signature": signDodoWebhook(rawBody, event.providerEventId, timestamp, fixtureSecret) };
    const unresolved = await billing.receiveWebhook(rawBody, headers);
    await expect(billing.processWebhook(unresolved.eventId)).rejects.toThrow("workspace association");
    expect(repository.webhookEvents.get(unresolved.eventId)?.error_code).toBe("WORKSPACE_UNRESOLVED");

    await billing.processVerifiedEvent(workspaceB, await provider.emit("sub-unresolved", "active"));
    const crossEvent = await provider.emit("sub-unresolved", "upgrade");
    const crossPayload = JSON.parse(JSON.stringify(crossEvent.payload)) as JsonObject;
    (crossPayload.data as JsonObject).metadata = { workspace_id: workspaceId };
    const crossRaw = JSON.stringify(crossPayload);
    const crossTimestamp = Math.floor(Date.parse(crossEvent.occurredAt) / 1_000);
    const crossId = "evt-cross-workspace";
    const cross = await billing.receiveWebhook(crossRaw, { "webhook-id": crossId, "webhook-timestamp": String(crossTimestamp), "webhook-signature": signDodoWebhook(crossRaw, crossId, crossTimestamp, fixtureSecret) });
    await expect(billing.processWebhook(cross.eventId)).rejects.toThrow("association");
    expect((await billing.getBillingOverview(workspaceId)).effectivePlan).toBe("free");
  });

  it("uses current Dodo checkout sessions and server-authorized customer portal sessions", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const provider = new DodoBillingProvider({
      apiKey: "test",
      webhookSecret: fixtureSecret,
      baseUrl: "https://test.dodopayments.com",
      catalog,
      fetcher: async (input, init) => {
        requests.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
        return String(input).includes("customer-portal")
          ? new Response(JSON.stringify({ link: "https://portal.dodo.test/session" }), { status: 200 })
          : new Response(JSON.stringify({ session_id: "cks_123", checkout_url: "https://checkout.dodo.test/session" }), { status: 200 });
      },
    });
    const checkout = await provider.createCheckout({ workspaceId, internalPlan: "pro", billingInterval: "monthly", providerProductId: "dodo_pro_monthly", providerCustomerId: "cus_123", returnUrl: "https://app.wanterest.com/app/settings/billing", checkoutReference: "checkout:test" });
    const portal = await provider.createPortalSession("cus_123", "https://app.wanterest.com/app/settings/billing");
    const checkoutBody = JSON.parse(requests[0].body ?? "{}") as { product_cart?: Array<{ product_id: string }>; customer?: { customer_id: string } };
    expect(checkout).toEqual({ providerCheckoutId: "cks_123", checkoutUrl: "https://checkout.dodo.test/session" });
    expect(checkoutBody.product_cart?.[0]?.product_id).toBe("dodo_pro_monthly");
    expect(checkoutBody.customer?.customer_id).toBe("cus_123");
    expect(portal.portalUrl).toBe("https://portal.dodo.test/session");
    expect(requests[1]?.url).toContain("/customers/cus_123/customer-portal/session");
  });

  it("reuses the persisted provider customer for the portal and keeps Free safe without a customer", async () => {
    const { billing, provider } = service();
    await expect(billing.createPortalSession(workspaceId)).rejects.toThrow("No Dodo billing customer");
    provider.seedSubscription({ providerSubscriptionId: "sub-customer", providerCustomerId: "cus-customer", internalPlan: "pro", billingInterval: "monthly" });
    await billing.processVerifiedEvent(workspaceId, await provider.emit("sub-customer", "active"));
    const portal = await billing.createPortalSession(workspaceId);
    expect(portal.portalUrl).toContain("cus-customer");
    expect(provider.checkoutInputs.size).toBe(0);
  });

  it("raises a typed, safe config error instead of a bare Error when Dodo product mapping is missing or duplicated", () => {
    expect(() => createDodoProductCatalog({ proMonthly: "", proAnnual: "pro-y", growthMonthly: "growth-m", growthAnnual: "growth-y" }))
      .toThrow(expect.objectContaining({ code: "BILLING_CONFIG_ERROR" }));
    expect(() => createDodoProductCatalog({ proMonthly: "same", proAnnual: "same", growthMonthly: "growth-m", growthAnnual: "growth-y" }))
      .toThrow(expect.objectContaining({ code: "BILLING_CONFIG_ERROR" }));
  });

  it("maps the new billing error codes to safe, distinct HTTP statuses", () => {
    expect(new AppError("BILLING_CONFIG_ERROR", "x").status).toBe(500);
    expect(new AppError("BILLING_PRODUCT_INVALID", "x").status).toBe(500);
    expect(new AppError("BILLING_PROVIDER_UNAVAILABLE", "x").status).toBe(503);
    expect(new AppError("CHECKOUT_SESSION_FAILED", "x").status).toBe(502);
  });

  it("normalizes a Dodo 4xx checkout rejection to a provider error without throwing on the new failure logging", async () => {
    const provider = new DodoBillingProvider({
      apiKey: "test",
      webhookSecret: fixtureSecret,
      baseUrl: "https://test.dodopayments.com",
      catalog,
      fetcher: async () => new Response(JSON.stringify({ code: "product_not_found", message: "Unknown product_id" }), { status: 400 }),
    });
    await expect(provider.createCheckout({
      workspaceId,
      internalPlan: "pro",
      billingInterval: "monthly",
      providerProductId: "dodo_pro_monthly",
      checkoutReference: "checkout:bad-product",
    })).rejects.toMatchObject(new BillingProviderError("PROVIDER_ERROR", "Dodo rejected the billing request."));
  });

  // Regression: checkout creation must call Dodo's real POST /checkouts endpoint, never
  // the old, nonexistent /checkout-sessions path that produced a live 403 on every
  // attempt. Also pins the exact request shape (Bearer auth, mapped product ID,
  // quantity 1) and response mapping (checkout_url/session_id) to the documented
  // /checkouts contract.
  it("calls POST /checkouts (never /checkout-sessions) with Bearer auth and the mapped product, and maps the response", async () => {
    let requestedUrl: string | undefined;
    let requestedMethod: string | undefined;
    let requestedAuth: string | undefined;
    let requestedBody: Record<string, unknown> | undefined;
    const provider = new DodoBillingProvider({
      apiKey: "sk_live_regression",
      webhookSecret: fixtureSecret,
      baseUrl: "https://live.dodopayments.com",
      catalog,
      fetcher: async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method;
        requestedAuth = init?.headers ? (init.headers as Record<string, string>).Authorization : undefined;
        requestedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ session_id: "cks_regression_1", checkout_url: "https://checkout.dodopayments.com/cks_regression_1" }), { status: 200 });
      },
    });

    const result = await provider.createCheckout({
      workspaceId,
      internalPlan: "pro",
      billingInterval: "monthly",
      providerProductId: "dodo_pro_monthly",
      providerCustomerId: "cus_existing_1",
      returnUrl: "https://app.wanterest.com/app/settings/billing?checkout=success",
      checkoutReference: "checkout:regression-1",
    });

    expect(requestedUrl).toBe("https://live.dodopayments.com/checkouts");
    expect(requestedUrl).not.toContain("/checkout-sessions");
    expect(requestedMethod).toBe("POST");
    expect(requestedAuth).toBe("Bearer sk_live_regression");
    expect(requestedBody).toMatchObject({
      product_cart: [{ product_id: "dodo_pro_monthly", quantity: 1 }],
      customer: { customer_id: "cus_existing_1" },
      return_url: "https://app.wanterest.com/app/settings/billing?checkout=success",
    });
    expect(result).toEqual({ providerCheckoutId: "cks_regression_1", checkoutUrl: "https://checkout.dodopayments.com/cks_regression_1" });
  });

  it("rejects a /checkouts response missing checkout_url instead of falling back to an unverified field name", async () => {
    const provider = new DodoBillingProvider({
      apiKey: "test",
      webhookSecret: fixtureSecret,
      baseUrl: "https://live.dodopayments.com",
      catalog,
      // "url" was a guessed fallback for the old wrong endpoint; the real /checkouts
      // contract only ever returns checkout_url, so this must NOT be accepted.
      fetcher: async () => new Response(JSON.stringify({ session_id: "cks_2", url: "https://not-the-real-field.example" }), { status: 200 }),
    });
    await expect(provider.createCheckout({
      workspaceId,
      internalPlan: "pro",
      billingInterval: "monthly",
      providerProductId: "dodo_pro_monthly",
      checkoutReference: "checkout:missing-url",
    })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  // Regression: a Dodo 403 ("credentials accepted, action denied") used to be collapsed
  // into the exact same BillingProviderError code as a 401 ("credentials not accepted"),
  // which made a working-but-unauthorized-for-this-action key indistinguishable in logs
  // from a genuinely misconfigured one. 401/403/404/422 must each surface distinctly.
  it("distinguishes 401/403/404/422 instead of collapsing them into one auth error", async () => {
    function providerRespondingWith(status: number, body: Record<string, unknown> = {}) {
      return new DodoBillingProvider({
        apiKey: "test",
        webhookSecret: fixtureSecret,
        baseUrl: "https://live.dodopayments.com",
        catalog,
        fetcher: async () => new Response(JSON.stringify(body), { status }),
      });
    }
    const checkout = (provider: DodoBillingProvider) => provider.createCheckout({
      workspaceId,
      internalPlan: "pro",
      billingInterval: "monthly",
      providerProductId: "dodo_pro_monthly",
      checkoutReference: "checkout:status-mapping",
    });

    await expect(checkout(providerRespondingWith(401))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(checkout(providerRespondingWith(403))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(checkout(providerRespondingWith(404))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(checkout(providerRespondingWith(422))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("checkConnectivity distinguishes a working key (200) from a denied one (403) without mutating anything", async () => {
    let requestedMethod: string | undefined;
    let requestedPath: string | undefined;
    const ok = new DodoBillingProvider({
      apiKey: "test",
      webhookSecret: fixtureSecret,
      baseUrl: "https://live.dodopayments.com",
      catalog,
      fetcher: async (url, init) => {
        requestedMethod = init?.method;
        requestedPath = String(url);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    });
    await expect(ok.checkConnectivity()).resolves.toEqual({ ok: true });
    expect(requestedMethod).toBe("GET");
    expect(requestedPath).toContain("/products");

    const denied = new DodoBillingProvider({
      apiKey: "test",
      webhookSecret: fixtureSecret,
      baseUrl: "https://live.dodopayments.com",
      catalog,
      fetcher: async () => new Response(JSON.stringify({}), { status: 403 }),
    });
    await expect(denied.checkConnectivity()).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
