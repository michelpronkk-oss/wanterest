import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layer 10 real-PostgreSQL proof. Opt-in: set WANTEREST_PG_TEST_HOST (host or
 * socket dir) and optionally WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a
 * THROWAWAY local server where the test may create and drop databases. It
 * applies every repository migration to a fresh database (with minimal Supabase
 * stubs), runs the SQL scenario, and proves two-session concurrency. Never point
 * this at a shared or production database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_l10_${process.pid}`;
const root = process.cwd();

function psql(db: string, args: string[], input?: string): string {
  return execFileSync("psql", ["-h", host!, "-p", port, "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

function psqlAsync(sql: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-h", host!, "-p", port, "-U", user, "-d", database, "-X", "-q", "-At", "-c", sql]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(!host)("Layer 10 actions_lifecycle_v1 on real PostgreSQL", () => {
  it("applies every migration, then proves constraints, RPC semantics, grants and concurrency", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }
      // Idempotent re-apply of the Layer 10 migration.
      psql(database, ["-f", path.join(root, "supabase/migrations/20261018000000_actions_lifecycle_v1.sql")]);

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/actions_lifecycle_postgres.sql")]);
      const checks = output.split("\n").filter((line) => line.startsWith("OK "));
      expect(checks.length).toBeGreaterThanOrEqual(50);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Concurrency fixtures: one concept with two basis rows.
      psql(database, ["-c", "select l10t.market('63000000-0000-4000-8000-000000000001', 'demand_clustering_v1', 'reporting', 1, null); select l10t.gap('64000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 1, null); select l10t.gap('64000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000001', 2, '64000000-0000-4000-8000-000000000001');"]);

      // 1) Same idempotency key, two sessions, different caller UUIDs: both converge on ONE stored row.
      const create = (id: string, key: string, gap: string, sleep: number) => `set request.jwt.claim.role = 'service_role'; begin; select (public.create_concept_action(l10t.payload('${id}', '${key}', '${gap}', 'reporting', 'demand_clustering_v1'))).id; select pg_sleep(${sleep}); commit;`;
      const [a, b] = await Promise.all([
        psqlAsync(create("74000000-0000-4000-8000-000000000001", "action:reporting:same", "64000000-0000-4000-8000-000000000001", 1.5)),
        new Promise<Awaited<ReturnType<typeof psqlAsync>>>((resolve) => setTimeout(() => resolve(psqlAsync(create("74000000-0000-4000-8000-000000000002", "action:reporting:same", "64000000-0000-4000-8000-000000000001", 0))), 300)),
      ]);
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);
      expect(a.stdout).toContain("74000000-0000-4000-8000-000000000001");
      expect(b.stdout).toContain("74000000-0000-4000-8000-000000000001");
      expect(psql(database, ["-c", "select count(*) from public.actions where trigger_concept_key = 'reporting'"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.usage_ledger where idempotency_key like 'action_generated:74000000%'"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.evidence_nodes where entity_table = 'actions' and entity_id = '74000000-0000-4000-8000-000000000002'"]).trim()).toBe("0");

      // 2) Concurrent supersession of the same old Action by two passes with different caller UUIDs: exactly one replacement.
      const supersede = (id: string, sleep: number) => `set request.jwt.claim.role = 'service_role'; begin; select (public.create_concept_action(l10t.payload('${id}', 'action:reporting:next', '64000000-0000-4000-8000-000000000002', 'reporting', 'demand_clustering_v1', 'concept_gap', repeat('7', 64)), '74000000-0000-4000-8000-000000000001', 'proposed')).id; select pg_sleep(${sleep}); commit;`;
      const [s1, s2] = await Promise.all([
        psqlAsync(supersede("75000000-0000-4000-8000-000000000001", 1.5)),
        new Promise<Awaited<ReturnType<typeof psqlAsync>>>((resolve) => setTimeout(() => resolve(psqlAsync(supersede("75000000-0000-4000-8000-000000000002", 0))), 300)),
      ]);
      expect(s1.code).toBe(0);
      expect(s2.code).toBe(0);
      expect(s1.stdout).toContain("75000000-0000-4000-8000-000000000001");
      expect(s2.stdout).toContain("75000000-0000-4000-8000-000000000001");
      expect(psql(database, ["-c", "select status || ':' || superseded_by_action_id from public.actions where id = '74000000-0000-4000-8000-000000000001'"]).trim()).toBe("superseded:75000000-0000-4000-8000-000000000001");
      expect(psql(database, ["-c", "select count(*) from public.actions where trigger_concept_key = 'reporting' and status in ('proposed','approved','in_progress')"]).trim()).toBe("1");

      // 3) Two different candidates (different keys) for the same concept at once: the one-open slot admits exactly one.
      psql(database, ["-c", "select l10t.gap('64000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000001', 3, '64000000-0000-4000-8000-000000000002'); update public.actions set status = 'dismissed', dismissed_at = now() where id = '75000000-0000-4000-8000-000000000001';"]);
      const fresh = (id: string, key: string, sleep: number) => `set request.jwt.claim.role = 'service_role'; begin; select (public.create_concept_action(l10t.payload('${id}', '${key}', '64000000-0000-4000-8000-000000000003', 'reporting', 'demand_clustering_v1', 'concept_gap', repeat('6', 64)))).id; select pg_sleep(${sleep}); commit;`;
      const [c1, c2] = await Promise.all([
        psqlAsync(fresh("76000000-0000-4000-8000-000000000001", "action:reporting:gap-pass", 1.5)),
        new Promise<Awaited<ReturnType<typeof psqlAsync>>>((resolve) => setTimeout(() => resolve(psqlAsync(fresh("76000000-0000-4000-8000-000000000002", "action:reporting:drift-pass", 0))), 300)),
      ]);
      expect(c1.code).toBe(0);
      expect(c2.stderr).toMatch(/actions_one_open_concept_action|duplicate key/);
      expect(psql(database, ["-c", "select count(*) from public.actions where trigger_concept_key = 'reporting' and status in ('proposed','approved','in_progress')"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.evidence_nodes where entity_table = 'actions' and entity_id = '76000000-0000-4000-8000-000000000002'"]).trim()).toBe("0");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  }, 120_000);
});
