import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260927212230_layer13a2b_cohort_benefits_billing_v1.sql"), "utf8");

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

  it("does not alter capability entitlements or add provider discount claims", () => {
    expect(migration).not.toContain("insert into public.workspace_entitlements");
    expect(migration).not.toContain("dodo_discount");
    expect(migration).not.toContain("coupon");
  });
});
