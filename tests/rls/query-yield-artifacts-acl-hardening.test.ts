import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDir = path.resolve(root, "supabase/migrations");
const migrationPath = path.join(migrationDir, "20261108000000_query_yield_artifacts_acl_hardening.sql");
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const read = (file: string) => readFileSync(path.resolve(root, file), "utf8");

describe("query_yield_artifacts ACL hardening", () => {
  it("A. revokes every table privilege from PUBLIC", () => {
    expect(migration).toMatch(/revoke all privileges on table public\.query_yield_artifacts from public\s*;/);
  });

  it("B. revokes every table privilege from anon and authenticated", () => {
    expect(migration).toMatch(/revoke all privileges on table public\.query_yield_artifacts from anon\s*;/);
    expect(migration).toMatch(/revoke all privileges on table public\.query_yield_artifacts from authenticated\s*;/);
  });

  it("C. grants service_role exactly SELECT and INSERT after clearing its old ACL", () => {
    expect(migration).toMatch(/revoke all privileges on table public\.query_yield_artifacts from service_role\s*;/);
    expect(migration).toMatch(/grant select, insert on table public\.query_yield_artifacts to service_role\s*;/);
    expect(migration).not.toMatch(/grant\s+(all|[^;]*\b(update|delete|truncate|references|trigger|maintain)\b)[^;]*on table public\.query_yield_artifacts/i);
  });

  it("D. drops only the obsolete authenticated member-select policy", () => {
    expect(migration).toContain("drop policy if exists query_yield_artifacts_member_select on public.query_yield_artifacts;");
    expect(migration).not.toMatch(/create\s+policy|disable\s+row\s+level\s+security/i);
  });

  it("E. does not mutate table ownership or data", () => {
    expect(migration).not.toMatch(/\b(owner to|delete from|truncate|insert into|update public\.)\b/i);
  });

  it("F. leaves schema-wide default privileges and unrelated table grants untouched", () => {
    expect(migration).not.toMatch(/alter\s+default\s+privileges/i);
    const executableSql = migration.replace(/--.*$/gm, "");
    const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
    expect(statements.every((statement) => statement.includes("public.query_yield_artifacts"))).toBe(true);
  });

  it("G. preserves the server-only immutable read/insert repository contract", () => {
    const repository = read("src/server/modules/operations/query-yield.repository.ts");
    expect(repository).toContain('import "server-only"');
    expect(repository).toContain('insert(row).select("*")');
    expect(repository).toContain('select("*")');
    expect(repository).not.toMatch(/\.update\(|\.delete\(|\.upsert\(/);
  });

  it("H. keeps production qya readers on server service clients", () => {
    for (const file of [
      "src/server/modules/onboarding/initial-scan.service.ts",
      "src/server/modules/ingestion/market-partition-refresh.service.ts",
      "src/server/modules/operations/incremental-product-matching.service.ts",
      "src/server/modules/operations/read-first-intelligence.repository.ts",
    ]) {
      expect(read(file)).toContain("createSupabaseServiceClient");
    }
    const admin = read("apps/admin/src/server/operations.ts");
    expect(admin).toContain("createAdminServiceClient");
    expect(admin).toContain('client.from("query_yield_artifacts").select(');
  });

  it("I. leaves the bounded service-role novelty RPC and its safe invoker context unchanged", () => {
    const v1 = read("supabase/migrations/20261107000000_signal_query_diversification_v1.sql").toLowerCase();
    expect(v1).toContain("security invoker");
    expect(v1).toContain("set search_path = ''");
    expect(v1).toContain("revoke all on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(v1).toContain("grant execute on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(v1).toContain("to service_role");
    expect(migration).not.toContain("signal_query_novelty_history");
  });

  it("J. leaves Signal Throughput V1 default-off", () => {
    expect(read("src/server/modules/operations/signal-query-diversification.config.ts"))
      .toContain('env.SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED === "true"');
    expect(migration).not.toContain("signal_query_diversification_v1_enabled");
    expect(migration).not.toContain("source_query_executions");
  });

  it("keeps ACL hardening at 080, V1.1 at 090, and Pagination V1 after it", () => {
    const forward = readdirSync(migrationDir).filter((name) => /^2026110[8-9]|^2026111/.test(name)).sort();
    expect(forward).toEqual([
      "20261108000000_query_yield_artifacts_acl_hardening.sql",
      "20261109000000_signal_query_exploration_v11.sql",
      "20261110000000_signal_pagination_depth_v1.sql",
    ]);
  });
});
