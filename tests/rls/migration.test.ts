import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260919000000_phase1_foundation.sql"),
  "utf8",
);

describe("Phase 1 RLS and integrity migration contract", () => {
  it("enables RLS on every Phase 1 table", () => {
    for (const table of [
      "workspaces",
      "workspace_members",
      "plan_catalog",
      "plan_entitlements",
      "workspace_entitlements",
      "usage_ledger",
      "audit_log",
      "engine_versions",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("contains membership-based policies and denies direct browser writes", () => {
    expect(migration).toContain("public.is_workspace_member");
    expect(migration).toContain("public.has_workspace_role");
    expect(migration).toContain("revoke insert, update, delete on public.usage_ledger from anon, authenticated");
    expect(migration).toContain("revoke insert, update, delete on public.audit_log from anon, authenticated");
  });

  it("contains the database integrity and atomic usage primitives", () => {
    expect(migration).toContain("unique (workspace_id, id)");
    expect(migration).not.toContain("unique (id, id)");
    expect(migration).toContain("foreign key (workspace_id, actor_membership_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("usage_limit_exceeded");
    expect(migration).toContain("workspace_slug_already_exists");
  });

  it("encodes owner/admin/member/viewer administration boundaries", () => {
    expect(migration).toContain("array['owner', 'admin']");
    expect(migration).toContain("array['owner']");
    expect(migration).toContain("workspace_requires_owner");
    expect(migration).toContain("role in ('owner', 'admin', 'member', 'viewer')");
  });
});
