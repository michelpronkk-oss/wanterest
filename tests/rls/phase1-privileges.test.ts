import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260926000000_phase1_privilege_correction.sql"),
  "utf8",
);

describe("Phase 1 privilege correction contract", () => {
  it("grants authenticated reads without granting browser writes", () => {
    expect(migration).toContain("grant select on public.workspaces");
    expect(migration).toContain("public.workspace_members");
    expect(migration).toContain("to authenticated");
    const authenticatedGrantSection = migration.split("grant all on public.workspaces")[0];
    expect(authenticatedGrantSection).not.toContain("grant all");
  });

  it("restores server-role table access without changing RLS policy definitions", () => {
    expect(migration).toContain("grant all on public.workspaces");
    expect(migration).toContain("public.engine_versions");
    expect(migration).not.toContain("disable row level security");
    expect(migration).not.toContain("drop policy");
  });
});
