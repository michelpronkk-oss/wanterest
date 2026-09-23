import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Paywalls + Upgrade UX v1 contracts", () => {
  it("makes Billing discoverable and keeps the shared upgrade entry point", () => {
    const settingsTabs = read("src/components/dashboard/settings-tabs.tsx");
    const upgrade = read("src/components/dashboard/upgrade-surface.tsx");
    expect(settingsTabs).toContain('href="/app/settings/billing"');
    expect(settingsTabs).toContain('label: "Billing"');
    expect(upgrade).toContain('"/api/billing/checkout"');
    expect(upgrade).toContain('"/api/billing/portal"');
    expect(upgrade).toContain('"monthly", "annual"');
    expect(upgrade).toContain("Save 20%");
  });

  it("submits canonical plan/cadence checkout input and never accepts a provider product id", () => {
    const upgrade = read("src/components/dashboard/upgrade-surface.tsx");
    const application = read("src/server/modules/billing/billing.application.ts");
    expect(upgrade).toContain("body: JSON.stringify({ plan, cadence");
    expect(upgrade).not.toContain("product_id");
    expect(application).toContain("getDodoProductCatalog");
    expect(application).toContain("CHECKOUT_RETURN_URL");
  });

  it("keeps checkout confirmation bounded and webhook-authoritative", () => {
    const status = read("src/components/dashboard/billing-checkout-status.tsx");
    const webhook = read("src/app/api/webhooks/dodo/route.ts");
    expect(status).toContain("POLL_TIMEOUT_MS = 25_000");
    expect(status).toContain("/api/billing/overview");
    expect(status).toContain("router.refresh()");
    expect(status).not.toContain("effectivePlan =");
    expect(webhook).toContain('revalidatePath("/app", "layout")');
  });

  it("surfaces contextual gates for every v1 restricted capability", () => {
    const home = read("src/app/app/(product)/page.tsx");
    const drift = read("src/app/app/(product)/insights/drift/page.tsx");
    const geo = read("src/components/dashboard/geography-surface.tsx");
    const experiments = read("src/app/app/(product)/experiments/page.tsx");
    const product = read("src/components/dashboard/product-lifecycle.tsx");
    const scan = read("src/components/dashboard/scan-progress-modal.tsx");
    const settings = read("src/app/app/settings/page.tsx");
    expect(home).toContain("Locked on Free");
    expect(drift).toContain("Demand Drift is a paid insight");
    expect(geo).toContain("Unlock regional intelligence");
    expect(experiments).toContain("Experiments are available on Pro");
    expect(product).toContain("Product limit reached");
    expect(scan).toContain("upgradeTarget");
    expect(settings).toContain("Seat limit reached");
  });
});
