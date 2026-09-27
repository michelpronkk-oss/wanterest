import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260927100000_layer13a1_waitlist_foundation_v1.sql", "utf8");

describe("Layer 13A.1 waitlist migration contract", () => {
  it("uses additive private tables with no anonymous or authenticated table access", () => {
    expect(migration).toContain("create table if not exists public.waitlist_applications");
    expect(migration).toContain("create table if not exists public.waitlist_application_events");
    expect(migration).toContain("alter table public.waitlist_applications enable row level security");
    expect(migration).toContain("alter table public.waitlist_application_events enable row level security");
    expect(migration).toContain("revoke all on public.waitlist_applications from anon, authenticated");
    expect(migration).toContain("revoke all on public.waitlist_application_events from anon, authenticated");
    expect(migration).toContain("grant all on public.waitlist_applications to service_role");
    expect(migration).toContain("grant all on public.waitlist_application_events to service_role");
  });

  it("allocates numbers from a sequence and never uses MAX()+1", () => {
    expect(migration).toContain("create sequence if not exists public.waitlist_early_access_number_seq");
    expect(migration).toContain("nextval('public.waitlist_early_access_number_seq')");
    expect(migration).not.toMatch(/max\s*\(\s*early_access_number\s*\)\s*\+\s*1/i);
    expect(migration).toContain("early_access_number_immutable");
    expect(migration).toContain("waitlist_application_delete_forbidden");
  });

  it("keeps review approval separate from access provisioning", () => {
    expect(migration).toContain("approved_for_invite");
    expect(migration).toContain("invalid_waitlist_transition");
    expect(migration).not.toContain("auth.admin.createUser");
    expect(migration).not.toContain("create_workspace");
    expect(migration).not.toContain("workspace_members");
  });

  it("exposes only hashed opaque tokens through server-side functions", () => {
    expect(migration).toContain("verification_token_hash text not null unique");
    expect(migration).toContain("status_token_hash text not null unique");
    expect(migration).toContain("grant execute on function public.verify_waitlist_application(text) to service_role");
    expect(migration).toContain("grant execute on function public.get_waitlist_application_by_status_token(text) to service_role");
    expect(migration).toContain("waitlist_application_events_append_only");
  });
});
