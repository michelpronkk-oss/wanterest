import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const creationMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261006000000_semantic_shadow_reasoning_v1.sql"),
  "utf8",
);
const privilegeMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261022000000_semantic_shadow_reasoning_service_role_grant.sql"),
  "utf8",
);
const privilegeSql = privilegeMigration.replace(/--[^\r\n]*/g, "");
const repository = readFileSync(
  path.resolve(process.cwd(), "src/server/modules/intelligence/semantic-shadow-reasoning.repository.ts"),
  "utf8",
);

describe("semantic shadow reasoning service-role privilege contract", () => {
  it("grants only the privileges required by the server repository", () => {
    expect(privilegeSql).toContain(
      "grant select, insert, update on public.semantic_shadow_reasoning to service_role;",
    );
    expect(privilegeSql).not.toMatch(/grant\s+all\s+on\s+public\.semantic_shadow_reasoning/i);
    expect(privilegeSql).not.toMatch(/grant[\s\S]*delete[\s\S]*semantic_shadow_reasoning/i);
    expect(privilegeSql).not.toMatch(/\b(anon|authenticated)\b/i);
  });

  it("preserves the existing RLS policy and denies direct anonymous/authenticated writes", () => {
    expect(creationMigration).toContain("alter table public.semantic_shadow_reasoning enable row level security;");
    expect(creationMigration).toContain(
      "create policy semantic_shadow_reasoning_member_select on public.semantic_shadow_reasoning for select to authenticated using (public.is_workspace_member(workspace_id));",
    );
    expect(creationMigration).toContain(
      "revoke insert, update, delete on public.semantic_shadow_reasoning from anon, authenticated;",
    );
    expect(privilegeSql).not.toMatch(/alter\s+table[\s\S]*semantic_shadow_reasoning[\s\S]*(disable|force)\s+row\s+level\s+security/i);
    expect(privilegeSql).not.toMatch(/(drop|create)\s+policy/i);
  });

  it("matches the repository's actual read, insert, and comparison-update operations", () => {
    expect(repository).toContain('select("*")');
    expect(repository).toContain(".insert(row)");
    expect(repository).toContain(".update({");
    expect(repository).not.toMatch(/\.delete\s*\(/);
  });
});
