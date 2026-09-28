import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260928025042_layer13a5_plpgsql_ambiguity_repair.sql"), "utf8");

const collisionNames = [
  "waitlist_application_id",
  "invite_id",
  "admission_id",
  "workspace_id",
  "user_id",
  "membership_id",
  "email",
  "normalized_email",
  "status",
  "token_hash",
  "cohort",
  "cohort_number",
  "benefit_policy_key",
  "onboarding_status",
  "source",
  "issued_at",
  "expires_at",
  "accepted_at",
  "revoked_at",
  "admitted_at",
  "created_at",
  "updated_at",
  "id",
];

const functionBlocks = migration
  .split(/(?=create or replace function public\.)/i)
  .filter((block) => block.trim().startsWith("create or replace function public."));

describe("13A.5 PL/pgSQL ambiguity repair migration contract", () => {
  it("replaces all four 13A.5 RPCs without changing their signatures", () => {
    expect(functionBlocks).toHaveLength(4);
    expect(migration).toContain("create or replace function public.issue_waitlist_admission_invite(");
    expect(migration).toContain("p_waitlist_application_id uuid,");
    expect(migration).toContain("create or replace function public.revoke_waitlist_admission_invite(");
    expect(migration).toContain("p_invite_id uuid,");
    expect(migration).toContain("create or replace function public.get_waitlist_admission_status_by_token(");
    expect(migration).toContain("p_status_token_hash text");
    expect(migration).toContain("create or replace function public.accept_waitlist_admission_invite(");
    expect(migration).toContain("p_token_hash text,");
    expect(migration).toContain("p_user_id uuid,");
  });

  it("qualifies collision-prone columns in predicates and joins", () => {
    for (const block of functionBlocks) {
      for (const name of collisionNames) {
        const unqualifiedPredicate = new RegExp(`(?:where|and|on|order\\s+by|group\\s+by)\\s+${name}\\s*(?:=|<|>|,|asc\\b|desc\\b)`, "i");
        expect(block).not.toMatch(unqualifiedPredicate);
      }
    }

    expect(migration).toContain("admission.waitlist_application_id = v_application.id");
    expect(migration).toContain("invite.status = 'issued'");
    expect(migration).toContain("application.status_token_hash = p_status_token_hash");
    expect(migration).toContain("assignment.* into v_assignment");
  });

  it("does not use ambiguity directives or broaden the security boundary", () => {
    expect(migration).not.toContain("#variable_conflict");
    expect(migration.match(/security definer/g)?.length).toBe(4);
    expect(migration.match(/set search_path = public, auth/g)?.length).toBe(4);
    expect(migration).not.toContain("set search_path = public, auth, extensions");
  });

  it("preserves the admission invariants and extension-independent token contract", () => {
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("waitlist_admission_email_mismatch");
    expect(migration).toContain("assign_workspace_cohort_membership_with_benefit");
    expect(migration).toContain("initialize_workspace_public_cohort_profile");
    expect(migration).toContain("token_hash = p_token_hash");
    expect(migration).not.toContain("gen_random_bytes");
    expect(migration).not.toContain("digest(");
  });
});
