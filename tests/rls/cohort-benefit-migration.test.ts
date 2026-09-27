import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260927212230_layer13a2b_cohort_benefits_billing_v1.sql"), "utf8");
const providerMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260927222103_layer13a2b_dodo_provider_discount_bindings_v1.sql"), "utf8");

describe("13A.2B cohort benefit migration contract", () => {
  it("keeps benefit state additive and workspace-scoped", () => {
    expect(migration).toContain("create table if not exists public.workspace_cohort_benefit_entitlements");
    expect(migration).toContain("create table if not exists public.workspace_cohort_benefit_events");
    expect(migration).toContain("foreign key (workspace_id, cohort_membership_id)");
    expect(migration).toContain("foreign key (workspace_id, activation_subscription_id)");
    expect(migration).toContain("unique (workspace_id)");
    expect(migration).toContain("policy_key text not null");
    expect(migration).toContain("duration_months smallint not null");
    expect(migration).toContain("status in ('eligible', 'revoked') or activated_at is not null");
    expect(migration).toContain("status in ('eligible', 'revoked') or expires_at is not null");
  });

  it("denies browser mutation and exposes only membership-checked read access", () => {
    expect(migration).toMatch(/revoke all on public\.workspace_cohort_benefit_entitlements from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke all on public\.workspace_cohort_benefit_events from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select on public\.workspace_cohort_benefit_entitlements to authenticated/i);
    expect(migration).toMatch(/grant all on public\.workspace_cohort_benefit_entitlements to service_role/i);
    expect(migration).toMatch(/grant all on public\.workspace_cohort_benefit_events to service_role/i);
    expect(migration).toMatch(/create policy workspace_cohort_benefit_entitlements_member_select[\s\S]*public\.is_workspace_member\(workspace_id\)/i);
    expect(migration).toMatch(/grant execute on function public\.get_workspace_cohort_benefit\(uuid\) to authenticated, service_role/i);
    expect(migration).not.toMatch(/grant execute on function public\.(grant|activate|revoke)_workspace_cohort_benefit[^\n]*authenticated/i);
  });

  it("uses append-only audit events and idempotent service operations", () => {
    expect(migration).toContain("workspace_cohort_benefit_events_append_only");
    expect(migration).toContain("unique (event_key)");
    expect(migration).toContain("on conflict (workspace_id) do nothing");
    expect(migration).toContain("benefit-granted:");
    expect(migration).toContain("benefit-activated:");
    expect(migration).toContain("make_interval(months => v_entitlement.duration_months)");
    expect(migration).toContain("assign_workspace_cohort_membership_with_benefit");
  });

  it("keeps Dodo provider bindings private, interval-scoped, and historically replaceable", () => {
    expect(providerMigration).toContain("create table if not exists public.workspace_cohort_benefit_provider_bindings");
    expect(providerMigration).toContain("foreign key (workspace_id, entitlement_id)");
    expect(providerMigration).toContain("billing_interval text not null check (billing_interval in ('monthly', 'annual'))");
    expect(providerMigration).toContain("cycle_limit integer not null check (cycle_limit > 0)");
    expect(providerMigration).toContain("provider_customer_id text");
    expect(providerMigration).toContain("p_provider_customer_id text");
    expect(providerMigration).toContain('customer-specific discount is attached only to the authoritative workspace billing customer');
    expect(providerMigration).toContain("grant execute on function public.upsert_workspace_cohort_benefit_provider_binding(uuid, uuid, text, text, text, text, text, integer, integer) to service_role");
    expect(providerMigration).toMatch(/revoke all on public\.workspace_cohort_benefit_provider_bindings from public, anon, authenticated/i);
    expect(providerMigration).toMatch(/grant all on public\.workspace_cohort_benefit_provider_bindings to service_role/i);
    expect(providerMigration).toContain("status = 'superseded'");
    expect(providerMigration).toContain("upsert_workspace_cohort_benefit_provider_binding");
  });

  it("does not alter capability entitlements or make Dodo the benefit authority", () => {
    expect(migration).not.toContain("insert into public.workspace_entitlements");
    expect(providerMigration).toContain("Wanterest entitlement terms and calendar expiry remain authoritative");
    expect(providerMigration).not.toContain("policy_key = 'dodo'");
  });
});
