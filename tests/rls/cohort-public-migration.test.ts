import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260928004407_layer13a4_public_cohort_profiles_v1.sql",
  "utf8",
);
const repairMigration = readFileSync(
  "supabase/migrations/20260928012224_layer13a4_monogram_normalization_repair.sql",
  "utf8",
);

describe("Layer 13A.4 public cohort profile migration contract", () => {
  it("keeps public settings separate from authoritative cohort identity", () => {
    expect(migration).toContain("create table if not exists public.workspace_public_cohort_profiles");
    expect(migration).toContain("foreign key (workspace_id, cohort_membership_id)");
    expect(migration).toContain("unique (workspace_id)");
    expect(migration).toContain("wall_visible boolean not null default false");
    expect(migration).toContain("pass_visible boolean not null default false");
    expect(migration).not.toMatch(/insert\s+into\s+public\.workspace_public_cohort_profiles\s+select/i);
    expect(migration).not.toMatch(/update\s+public\.workspace_cohort_memberships/i);
    expect(migration).not.toMatch(/next_number\s*=|assigned_count\s*=/i);
  });

  it("enforces safe slugs and HTTPS-only public references", () => {
    expect(migration).toContain("public_slug ~ '^[a-z0-9]+(-[a-z0-9]+){0,11}$'");
    expect(migration).toContain("public_slug not in");
    expect(migration).toContain("logo_url ~ '^https://[^[:space:]]+$'");
    expect(migration).toContain("avatar_url ~ '^https://[^[:space:]]+$'");
    expect(migration).toContain("website_url ~ '^https://[^[:space:]]+$'");
  });

  it("keeps private tables closed and exposes only narrow RPCs", () => {
    expect(migration).toContain("alter table public.workspace_public_cohort_profiles enable row level security");
    expect(migration).toContain("revoke all on public.workspace_public_cohort_profiles from public, anon, authenticated");
    expect(migration).toContain("grant all on public.workspace_public_cohort_profiles to service_role");
    expect(migration).toContain("grant execute on function public.get_public_cohort_wall(text) to anon, authenticated, service_role");
    expect(migration).toContain("grant execute on function public.get_public_cohort_profile(text) to anon, authenticated, service_role");
    expect(migration).toContain("revoke all on function public.upsert_workspace_public_cohort_profile");
    expect(migration).toContain("grant execute on function public.upsert_workspace_public_cohort_profile");
    expect(migration).toContain("public.has_workspace_role(p_workspace_id, array['owner', 'admin'])");
    expect(migration).toContain("public.is_service_role()");
  });

  it("prevents public self-claims and preserves audit boundaries", () => {
    expect(migration).toContain("workspace_cohort_membership_not_found");
    expect(migration).toContain("public_profile_created");
    expect(migration).toContain("wall_visibility_enabled");
    expect(migration).toContain("pass_visibility_enabled");
    expect(migration).toContain("public_profile_updated");
    expect(migration).toContain("order by membership.cohort_number asc");
  });

  it("serializes same-workspace initialization and leaves slug races to the unique index", () => {
    expect(migration).toContain("public_slug text not null unique");
    expect(migration).toContain("unique (workspace_id)");
    expect(migration).toContain("where m.workspace_id = p_workspace_id\n   for update");
    expect(migration).toContain("public_cohort_slug_conflict");
  });

  it("keeps SQL monogram derivation aligned with the application V1 contract", () => {
    expect(repairMigration).toContain("create or replace function public.derive_public_cohort_monogram(p_display_name text)");
    expect(repairMigration).toContain("normalize(coalesce(p_display_name, ''), NFKC)");
    expect(repairMigration).toContain("when coalesce(array_length(parts, 1), 0) >= 2 then left(parts[1], 1) || left(parts[2], 1)");
    expect(repairMigration).toContain("when coalesce(array_length(parts, 1), 0) = 1 then left(parts[1], 1)");
    expect(repairMigration).toContain("else 'WN'");
    expect(repairMigration).toContain("v_monogram := public.derive_public_cohort_monogram(v_display_name);");
    expect(repairMigration).toContain("security definer");
    expect(repairMigration).toContain("set search_path = public, auth");
    expect(repairMigration).toContain("^[A-Z0-9]{1,3}$");
    expect(repairMigration).toContain("grant execute on function public.upsert_workspace_public_cohort_profile");
  });
});
