import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924000000_phase6_billing.sql"), "utf8");

describe("Phase 6 billing migration contract", () => {
  it("owns normalized billing state and internal Pro/Growth catalog revisions", () => {
    expect(migration).toContain("create table if not exists public.billing_customers");
    expect(migration).toContain("create table if not exists public.subscriptions");
    expect(migration).toContain("create table if not exists public.billing_webhook_events");
    expect(migration).toContain("create table if not exists public.billing_checkout_requests");
    expect(migration).toContain("('pro', 1, 'active'");
    expect(migration).toContain("('growth', 1, 'active'");
    expect(migration).toContain("resolve_billing_entitlements");
    expect(migration).toContain("apply_normalized_subscription");
  });

  it("keeps provider references out of capability authority and protects mutation paths", () => {
    expect(migration).toContain("internal_plan text not null check (internal_plan in ('free', 'pro', 'growth'))");
    expect(migration).toContain("alter table public.billing_webhook_events enable row level security");
    expect(migration).toContain("revoke all on public.billing_webhook_events from anon, authenticated");
    expect(migration).toContain("revoke all on public.subscriptions from anon, authenticated");
    expect(migration).toContain("grant all on public.billing_webhook_events to service_role");
    expect(migration).toContain("foreign key (workspace_id, billing_customer_id)");
    expect(migration).toContain("source_subscription_id");
  });

  it("does not introduce payment-instrument persistence", () => {
    expect(migration.toLowerCase()).not.toMatch(/\b(card_number|pan|cvv|cvc)\b/);
  });
});

