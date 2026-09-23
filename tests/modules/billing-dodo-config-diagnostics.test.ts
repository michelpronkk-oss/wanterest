import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkDodoConnectivity } = await import("../../src/server/modules/billing/billing.application");

// Regression coverage for the Dodo config hardening: env values are trimmed exactly
// once before use, and an internally-malformed key/product ID (a pasted line break or
// doubled space, invisible in most dashboard UIs) is rejected up front with a typed
// BILLING_CONFIG_ERROR before any network call, instead of surfacing as an
// indistinguishable-from-routine-401/403 provider rejection.

const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DODO_WEBHOOK_SECRET: "whsec_test",
  DODO_PAYMENTS_ENVIRONMENT: "live_mode",
  DODO_PRODUCT_PRO_MONTHLY: "prod_pro_monthly",
  DODO_PRODUCT_PRO_ANNUAL: "prod_pro_annual",
  DODO_PRODUCT_GROWTH_MONTHLY: "prod_growth_monthly",
  DODO_PRODUCT_GROWTH_ANNUAL: "prod_growth_annual",
} as const;

function stubRequiredEnv() {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) vi.stubEnv(key, value);
}

describe("Dodo billing config diagnostics", () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchCalled = false;
    // If the malformed-config guard fails to short-circuit, this proves it by
    // failing the test instead of silently attempting a real network call.
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("network should not have been reached");
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("rejects an API key with internal whitespace before any network call", async () => {
    stubRequiredEnv();
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "sk_live_abc\ndef");

    await expect(checkDodoConnectivity()).rejects.toMatchObject({
      code: "BILLING_CONFIG_ERROR",
      details: { reason: "malformed_api_key" },
    });
    expect(fetchCalled).toBe(false);
  });

  it("accepts a key with only incidental leading/trailing whitespace by trimming it", async () => {
    stubRequiredEnv();
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "  sk_live_abc123  \n");
    global.fetch = (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;

    await expect(checkDodoConnectivity()).resolves.toEqual({ ok: true });
  });
});
