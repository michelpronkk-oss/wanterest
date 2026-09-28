import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260928031157_layer13a6_launch_access_mode_v1.sql"), "utf8");

describe("13A.6 launch/access migration contract", () => {
  it("starts safely in invite_only without creating production access state", () => {
    expect(migration).toContain("create table if not exists public.product_access_mode");
    expect(migration).toContain("values ('primary', 'invite_only'");
    const schemaOnly = migration.split("create or replace function public.get_product_access_policy")[0] ?? migration;
    expect(schemaOnly).not.toMatch(/insert\s+into\s+public\.(workspaces|workspace_members|workspace_admissions|waitlist_admission_invites|workspace_cohort_memberships)/i);
    expect(migration).toContain("product_access_mode_initialized");
  });

  it("keeps mode mutation private and exposes only the narrow public projection", () => {
    expect(migration).toContain("alter table public.product_access_mode enable row level security");
    expect(migration).toContain("revoke all on public.product_access_mode from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_product_access_state() to anon, authenticated, service_role");
    expect(migration).toContain("grant execute on function public.set_product_access_mode(text, text, uuid) to service_role");
    expect(migration).not.toMatch(/grant execute on function public\.set_product_access_mode[^\n]*authenticated/i);
    expect(migration).toContain("product_access_mode_events_append_only");
  });

  it("defines the explicit transition graph and mode-derived capabilities", () => {
    expect(migration).toContain("product_access_mode_transition_not_allowed");
    expect(migration).toContain("access.mode in ('waitlist', 'invite_only')");
    expect(migration).toContain("access.mode = 'invite_only'");
    expect(migration).toContain("access.mode = 'open'");
    expect(migration).toContain("access.mode <> 'open'");
  });

  it("extends admission source/idempotency additively and shares the provisioning primitive", () => {
    expect(migration).toContain("alter column waitlist_application_id drop not null");
    expect(migration).toContain("source = 'open_signup'");
    expect(migration).toContain("idempotency_key text");
    expect(migration).toContain("open-signup:' || p_user_id::text");
    expect(migration).toContain("create or replace function public.provision_workspace_admission");
    expect(migration).toContain("from public.provision_workspace_admission(");
    expect(migration).toContain("grant execute on function public.provision_workspace_admission");
  });

  it("protects verified email, transaction-local mode checks, and all canonical side effects", () => {
    expect(migration).toContain("open_signup_email_not_verified");
    expect(migration).toContain("for share");
    expect(migration).toContain("for update");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(v_expected_key, 0))");
    expect(migration).toContain("workspace_admissions_idempotency_key_idx");
    expect(migration).toContain("initialize_workspace_entitlements");
    expect(migration).toContain("assign_workspace_cohort_membership_with_benefit");
    expect(migration).toContain("initialize_workspace_public_cohort_profile");
    expect(migration).toContain("workspace.admission_completed");
    expect(migration).toContain("public_signup_not_allowed");
  });

  it("freezes new invite issuance in waitlist and preserves existing acceptance", () => {
    expect(migration).toContain("waitlist_invite_issuance_disabled_by_access_mode");
    expect(migration).toContain("invite_acceptance_allowed");
    expect(migration).toContain("v_invite.status = 'accepted'");
    expect(migration).toContain("waitlist_admission_email_mismatch");
  });
});
