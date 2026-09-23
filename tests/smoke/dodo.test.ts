import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkDodoConnectivity, checkDodoCheckoutSmoke } = await import("../../src/server/modules/billing/billing.application");

// Not run in CI/normal `npm test` — requires real, potentially live, Dodo credentials.
// Enable with RUN_DODO_SMOKE=1 (see scripts/smoke-dodo.mjs / `npm run smoke:dodo`).
//
// This proves, independent of checkout, whether the configured DODO_PAYMENTS_API_KEY
// authenticates against the resolved DODO_PAYMENTS_ENVIRONMENT host at all:
//   - succeeds here, checkout still fails -> the key/host are fine; the account or the
//     checkout action specifically is being denied/misrouted.
//   - fails here too (401/403)            -> the key, its environment, or the resolved
//     base URL is wrong; look no further than credentials/config.
// It only ever performs a bounded, one-item product list read and never creates,
// updates, or deletes anything.
const live = process.env.RUN_DODO_SMOKE === "1" ? it : it.skip;

// Separately opt-in (RUN_DODO_CHECKOUT_SMOKE=1): actually exercises POST /checkouts —
// the exact route production uses — with the real "pro monthly" product mapping. This
// creates one real, uncompleted, non-billed checkout session on the live Dodo account
// (obviously identifiable by its "smoke-test:" checkoutReference) but never confirms it
// or visits the returned checkout_url, so no payment can occur.
const liveCheckout = process.env.RUN_DODO_CHECKOUT_SMOKE === "1" ? it : it.skip;

describe("Dodo live connectivity smoke", () => {
  live("authenticates against the resolved API host with a harmless read", async () => {
    const result = await checkDodoConnectivity();
    console.info(JSON.stringify(result, null, 2));
    expect(result.ok).toBe(true);
  }, 15_000);

  liveCheckout("creates a real checkout session via POST /checkouts and returns a hosted checkout URL", async () => {
    const result = await checkDodoCheckoutSmoke();
    console.info(JSON.stringify({ providerCheckoutId: result.providerCheckoutId, checkoutUrlHost: new URL(result.checkoutUrl).host }, null, 2));
    expect(result.providerCheckoutId).toBeTruthy();
    expect(result.checkoutUrl).toMatch(/^https:\/\//);
  }, 15_000);
});
