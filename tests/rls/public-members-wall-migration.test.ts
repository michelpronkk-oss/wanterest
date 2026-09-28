import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261030000000_public_members_wall_active_workspace_repair.sql"), "utf8");

describe("Public Members Wall active-workspace repair", () => {
  it("keeps the established public projection narrow while enforcing live workspace eligibility", () => {
    expect(migration).toContain("create or replace function public.get_public_cohort_wall(p_cohort text)");
    expect(migration).toContain("join public.workspace_cohort_memberships as membership");
    expect(migration).toContain("join public.workspaces as workspace");
    expect(migration).toContain("workspace.status = 'active'");
    expect(migration).toContain("profile.wall_visible = true");
    expect(migration).toContain("membership.cohort = p_cohort");
    expect(migration).toContain("membership.workspace_id = profile.workspace_id");
    expect(migration).toContain("order by membership.cohort_number asc");
    expect(migration).not.toContain("workspace_id uuid");
    expect(migration).not.toContain("email");
  });

  it("preserves the public RPC grant and rejects unknown cohorts", () => {
    expect(migration).toContain("p_cohort not in ('founding_25', 'early_100')");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("revoke all on function public.get_public_cohort_wall(text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_public_cohort_wall(text) to anon, authenticated, service_role");
  });

  it("keeps wall and pass consent independent while revoking both public surfaces for inactive workspaces", () => {
    expect(migration).toContain("where profile.wall_visible = true and membership.cohort = p_cohort");
    expect(migration).toContain("create or replace function public.get_public_cohort_profile(p_public_slug text)");
    expect(migration).toContain("and profile.pass_visible = true");
    expect(migration).toContain("grant execute on function public.get_public_cohort_profile(text) to anon, authenticated, service_role");
  });
});
