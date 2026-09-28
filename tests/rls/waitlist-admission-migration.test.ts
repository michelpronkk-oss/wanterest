import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260928015335_layer13a5_invite_admission_reveal_v1.sql"), "utf8");

describe("13A.5 invite/admission migration contract", () => {
  it("keeps invite and admission state separate from the waitlist lifecycle", () => {
    expect(migration).toContain("status in ('issued', 'accepted', 'expired', 'revoked')");
    expect(migration).toContain("onboarding_status text not null default 'required'");
    expect(migration).toContain("status <> 'accepted' or admission_id is not null");
    expect(migration).toContain("waitlist_application_id uuid not null unique");
    expect(migration).toContain("invite_id uuid not null unique");
    expect(migration).toContain("approved_for_invite");
  });

  it("stores only a high-entropy hash and enforces one active invite", () => {
    expect(migration).toContain("token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain("where status = 'issued'");
    expect(migration).toContain("v_now + interval '7 days'");
    expect(migration).not.toContain("raw_token");
    expect(migration).not.toContain("token text");
    expect(migration).toContain("invite_reissued");
    expect(migration).toContain("invite_expired");
  });

  it("keeps admission authoritative and reuses proven provisioning seams", () => {
    expect(migration).toContain("accept_waitlist_admission_invite");
    expect(migration).toContain("from auth.users u where u.id = p_user_id");
    expect(migration).toContain("waitlist_admission_email_mismatch");
    expect(migration).toContain("initialize_workspace_entitlements");
    expect(migration).toContain("assign_workspace_cohort_membership_with_benefit");
    expect(migration).toContain("initialize_workspace_public_cohort_profile");
    expect(migration).toContain("cohort_number");
    expect(migration).not.toContain("admin.createUser");
    expect(migration).not.toContain("dodo");
    expect(migration).not.toContain("insert into public.subscriptions");
  });

  it("qualifies columns that could collide with PL/pgSQL output variables", () => {
    expect(migration).toContain("from public.waitlist_admission_invites as invite");
    expect(migration).toContain("invite.status = 'issued'");
    expect(migration).toContain("from public.waitlist_applications as application");
    expect(migration).toContain("application.id = p_waitlist_application_id");
  });

  it("uses service-only database access with append-only events", () => {
    expect(migration).toContain("alter table public.waitlist_admission_invites enable row level security");
    expect(migration).toContain("alter table public.workspace_admissions enable row level security");
    expect(migration).toContain("alter table public.waitlist_admission_events enable row level security");
    expect(migration).toContain("revoke all on public.waitlist_admission_invites from public, anon, authenticated");
    expect(migration).toContain("revoke all on public.workspace_admissions from public, anon, authenticated");
    expect(migration).toContain("revoke all on public.waitlist_admission_events from public, anon, authenticated");
    expect(migration).toContain("waitlist_admission_events_append_only");
    expect(migration).toContain("grant execute on function public.accept_waitlist_admission_invite(text, uuid, text) to service_role");
    expect(migration).not.toContain("grant execute on function public.accept_waitlist_admission_invite(text, uuid, text) to authenticated");
  });

  it("does not create rows or consume cohort inventory during migration", () => {
    const schemaOnly = migration.split("create or replace function")[0] ?? migration;
    expect(schemaOnly).not.toMatch(/insert\s+into\s+public\.(waitlist_admission_invites|workspace_admissions|workspace_cohort_memberships)/i);
    expect(migration).not.toContain("next_number");
    expect(migration).not.toContain("early_access_number");
  });
});
