import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260927202715_layer13a2_cohort_membership_identity_v1.sql",
  "utf8",
);

describe("Layer 13A.2 cohort membership migration contract", () => {
  it("creates separate workspace identity and append-only provenance tables", () => {
    expect(migration).toMatch(/create table if not exists public\.workspace_cohort_memberships/i);
    expect(migration).toMatch(/create table if not exists public\.workspace_cohort_membership_events/i);
    expect(migration).toMatch(/create table if not exists public\.workspace_cohort_allocation_state/i);
    expect(migration).toMatch(/unique \(workspace_id\)/i);
    expect(migration).toMatch(/unique \(cohort, cohort_number\)/i);
    expect(migration).toMatch(/unique index if not exists workspace_cohort_memberships_source_waitlist_idx/i);
    expect(migration).toMatch(/event_type text not null check \(event_type in \('membership_assigned'\)\)/i);
    expect(migration).toMatch(/workspace_cohort_membership_events_append_only/i);
  });

  it("keeps the namespaces, caps, and allocator transactional", () => {
    expect(migration).toMatch(/cohort text not null check \(cohort in \('founding_25', 'early_100'\)\)/i);
    expect(migration).toMatch(/cohort = 'founding_25' and cohort_number between 1 and 25/i);
    expect(migration).toMatch(/cohort = 'early_100' and cohort_number between 1 and 100/i);
    expect(migration).toMatch(/for update;/i);
    expect(migration).toMatch(/set next_number = next_number \+ 1, assigned_count = assigned_count \+ 1/i);
    expect(migration).toMatch(/no_special_cohort/i);
    expect(migration).not.toMatch(/max\s*\(\s*cohort_number\s*\)\s*\+\s*1/i);
    expect(migration).not.toMatch(/nextval\s*\(\s*'public\.waitlist_early_access_number_seq'/i);
    expect(migration).not.toMatch(/update public\.waitlist_applications/i);
  });

  it("protects private tables and exposes only the authorized read function", () => {
    for (const table of [
      "workspace_cohort_allocation_state",
      "workspace_cohort_memberships",
      "workspace_cohort_membership_events",
    ]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      expect(migration).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, "i"));
      expect(migration).toMatch(new RegExp(`grant all on public\\.${table} to service_role`, "i"));
    }
    expect(migration).toMatch(/revoke all on function public\.assign_workspace_cohort_membership\(uuid, uuid, uuid, text, text\) from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.assign_workspace_cohort_membership\(uuid, uuid, uuid, text, text\) to service_role/i);
    expect(migration).toMatch(/grant execute on function public\.get_workspace_cohort_identity\(uuid\) to authenticated, service_role/i);
    expect(migration).not.toMatch(/grant select on public\.workspace_cohort_memberships to authenticated/i);
  });

  it("does not add a public assignment endpoint or later-phase implementation", () => {
    expect(existsSync("src/app/api/cohorts/route.ts")).toBe(false);
    expect(existsSync("src/app/api/cohort/route.ts")).toBe(false);
    expect(migration).not.toMatch(/priority_access/i);
    expect(migration).not.toMatch(/dodo/i);
    expect(migration).not.toMatch(/create_workspace\s*\(/i);
  });
});
