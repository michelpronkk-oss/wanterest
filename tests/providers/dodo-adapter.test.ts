import { describe, expect, it } from "vitest";

import { DodoBillingProvider } from "../../src/server/providers/billing/dodo/adapter";
import { createDodoProductCatalog } from "../../src/server/modules/billing/product-mapping";

const catalog = createDodoProductCatalog({
  proMonthly: "prod_pro_monthly",
  proAnnual: "prod_pro_annual",
  growthMonthly: "prod_growth_monthly",
  growthAnnual: "prod_growth_annual",
});
const webhookSecret = "Zml4dHVyZS1iaWxsaW5nLXNlY3JldA==";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("Dodo SDK adapter", () => {
  it("creates typed private percentage discounts with finite cycles and product restrictions", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    const provider = new DodoBillingProvider({
      apiKey: "test-key",
      webhookSecret,
      baseUrl: "https://test.dodopayments.com",
      catalog,
      fetcher: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, headers: new Headers(init?.headers) });
        return json({
          discount_id: "dsc_founder",
          code: "OPAQUE123",
          amount: 3000,
          type: "percentage",
          restricted_to: ["prod_pro_monthly", "prod_pro_annual"],
          subscription_cycles: 24,
          preserve_on_plan_change: false,
          metadata: { wanterest_entitlement_id: "ent-1" },
        });
      },
    });

    const discount = await provider.createDiscount({
      amountBasisPoints: 3000,
      productIds: ["prod_pro_monthly", "prod_pro_annual"],
      subscriptionCycles: 24,
      metadata: { wanterest_entitlement_id: "ent-1" },
      idempotencyKey: "wanterest:discount:ent-1:monthly:24",
    });

    expect(discount).toMatchObject({ providerDiscountId: "dsc_founder", code: "OPAQUE123", amountBasisPoints: 3000, subscriptionCycles: 24 });
    expect(requests[0]).toMatchObject({ url: "https://test.dodopayments.com/discounts" });
    expect(requests[0].body).toMatchObject({ amount: 3000, type: "percentage", restricted_to: ["prod_pro_monthly", "prod_pro_annual"], subscription_cycles: 24, preserve_on_plan_change: false });
    expect(requests[0].headers.get("idempotency-key")).toBe("wanterest:discount:ent-1:monthly:24");
  });

  it("pre-applies a server-selected code and disables arbitrary checkout code entry", async () => {
    let request: { body: Record<string, unknown>; headers: Headers } | undefined;
    const provider = new DodoBillingProvider({
      apiKey: "test-key",
      webhookSecret,
      baseUrl: "https://test.dodopayments.com",
      catalog,
      fetcher: async (_url, init) => {
        request = { body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, headers: new Headers(init?.headers) };
        return json({ session_id: "cks_1", checkout_url: "https://checkout.test/cks_1" });
      },
    });

    await provider.createCheckout({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      internalPlan: "pro",
      billingInterval: "monthly",
      providerProductId: "prod_pro_monthly",
      discountCodes: ["OPAQUE123"],
      checkoutReference: "checkout:benefit",
    });

    expect(request?.body).toMatchObject({ discount_codes: ["OPAQUE123"], feature_flags: { allow_discount_code: false } });
    expect(request?.headers.get("idempotency-key")).toBe("checkout:benefit");
  });

  it("replaces plan-change discount codes explicitly and reads the normalized subscription afterward", async () => {
    const paths: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const provider = new DodoBillingProvider({
      apiKey: "test-key",
      webhookSecret,
      baseUrl: "https://test.dodopayments.com",
      catalog,
      fetcher: async (url, init) => {
        paths.push(String(url));
        bodies.push(init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {});
        if (String(url).includes("change-plan")) return json({ payment_link: null });
        return json({
          id: "sub_1",
          subscription_id: "sub_1",
          customer_id: "cus_1",
          customer: { customer_id: "cus_1", email: "owner@example.test" },
          product_id: "prod_pro_annual",
          status: "active",
          current_period_end: "2027-01-01T00:00:00.000Z",
          discounts: [{ discount_id: "dsc_founder", code: "OPAQUE123", amount: 3000, type: "percentage", restricted_to: ["prod_pro_annual"], subscription_cycles: 2, cycles_remaining: 2, preserve_on_plan_change: false, metadata: {} }],
          updated_at: "2026-09-28T00:00:00.000Z",
        });
      },
    });

    const subscription = await provider.changeSubscription({
      providerSubscriptionId: "sub_1",
      providerProductId: "prod_pro_annual",
      billingInterval: "annual",
      discountCodes: ["OPAQUE123"],
    });

    expect(paths[0]).toContain("/subscriptions/sub_1/change-plan");
    expect(bodies[0]).toMatchObject({ product_id: "prod_pro_annual", quantity: 1, proration_billing_mode: "do_not_bill", discount_codes: ["OPAQUE123"] });
    expect(subscription.providerDiscounts?.[0]).toMatchObject({ providerDiscountId: "dsc_founder", cyclesRemaining: 2 });
  });
});

