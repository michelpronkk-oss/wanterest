import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261102000000_admin_console_foundation.sql"), "utf8").toLowerCase();

describe("admin foundation migration security contract", () => {
  it("keeps admin identity and audit tables behind RLS and service-role grants", () => {
    for (const table of ["admin_memberships", "admin_audit_events"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    expect(migration).toContain("grant select on public.admin_memberships to service_role");
    expect(migration).toContain("grant select, insert on public.admin_audit_events to service_role");
  });

  it("keys admin authority to Auth UUIDs and constrains roles and states", () => {
    expect(migration).toContain("user_id uuid primary key references auth.users(id) on delete restrict");
    expect(migration).toMatch(/actor_user_id uuid,/);
    expect(migration).not.toMatch(/actor_user_id uuid\s+references\s+auth\.users/i);
    expect(migration).toContain("role in ('founder', 'operations_admin', 'support', 'read_only_analyst')");
    expect(migration).toContain("status in ('active', 'revoked')");
    expect(migration).not.toContain("email text");
    expect(migration).not.toMatch(/insert\s+into\s+public\.admin_memberships/i);
    expect(migration).not.toMatch(/insert\s+into\s+auth\.users/i);
  });

  it("is additive and does not change customer lifecycle or RLS policy", () => {
    expect(migration).toContain("create table if not exists public.admin_memberships");
    expect(migration).toContain("create table if not exists public.admin_audit_events");
    expect(migration).not.toMatch(/alter\s+table\s+public\.(workspaces|waitlist|admissions|cohorts|share_cards)/i);
    expect(migration).not.toMatch(/create\s+policy/i);
  });

  it("makes audit records append-only and keeps audit payloads structured", () => {
    expect(migration).toContain("jsonb_typeof(context) = 'object'");
    expect(migration).toContain("before update or delete on public.admin_audit_events");
    expect(migration).toContain("admin_audit_events_are_append_only");
    expect(migration).not.toMatch(/actor_user_id\s+uuid\s+references\s+auth\.users\(id\)/i);
  });
});
