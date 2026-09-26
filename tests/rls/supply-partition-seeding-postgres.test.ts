import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layer 12A.2 real-PostgreSQL proof. Opt-in: set WANTEREST_PG_TEST_HOST (host or
 * socket dir) and optionally WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a
 * THROWAWAY local server where the test may create and drop databases. Never
 * point this at a shared or production database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_s12a2_${process.pid}`;
const root = process.cwd();

function psql(db: string, args: string[]): string {
  return execFileSync("psql", ["-h", host!, "-p", port, "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
type Run = { code: number | null; stdout: string; stderr: string };
function psqlAsync(sql: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-h", host!, "-p", port, "-U", user, "-d", database, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
const A = "'20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001'";
const B = "'20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002'";
const seedTx = (scope: string, key: string, qp: string, cap: number, sleep: number) => `begin; select s12s.seed(${scope}, 'planner_seed', '${key}', '${qp}', now(), ${cap}); select pg_sleep(${sleep}); commit;`;
const race = (first: string, second: string) => Promise.all([psqlAsync(first), new Promise<Run>((resolve) => setTimeout(() => resolve(psqlAsync(second)), 300))]);
const status = (run: Run) => run.stdout.split("\n").map((line) => line.trim()).find((line) => /^[a-z_]+$/.test(line));

describe.skipIf(!host)("Layer 12A.2 supply_partition_seeding_v1 on real PostgreSQL", () => {
  it("applies every migration, then proves grants, RLS, FKs, provenance, caps, expiry/renewal, lifecycle, retirement and concurrent seeding", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }
      // Re-applying the migration is a no-op (idempotent DDL).
      psql(database, ["-f", path.join(root, "supabase/migrations/20261021000000_supply_partition_seeding_v1.sql")]);

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/supply_partition_seeding_postgres.sql")]);
      expect(output.split("\n").filter((line) => line.startsWith("OK ")).length).toBeGreaterThanOrEqual(65);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Concurrent seeding of the same (workspace, product, partition) converges on one row: one create, one renew.
      const [a, b] = await race(seedTx(A, "k-race", "qp-race-1", 60, 1.5), seedTx(A, "k-race", "qp-race-2", 60, 0));
      expect([a.code, b.code]).toEqual([0, 0]);
      expect([status(a), status(b)].sort()).toEqual(["created", "renewed"]);
      expect(psql(database, ["-c", "select count(*) || ':' || max(renewal_count) from public.market_partition_interests where partition_key = 'market_partition_identity_v1:k-race'"]).trim()).toBe("1:1");
      expect(psql(database, ["-c", "select count(*) from public.market_partitions where partition_key = 'market_partition_identity_v1:k-race'"]).trim()).toBe("1");

      // Two products racing to seed two NEW partitions with exactly one slot left under the global per-source cap: exactly one wins.
      const seeded = Number(psql(database, ["-c", "select count(distinct market_partition_id) from public.market_partition_interests where source_key = 'github' and origin = 'planner_seed' and deactivated_at is null and expires_at > now()"]).trim());
      const [c, d] = await race(seedTx(A, "k-cap-a", "qp-cap-a", seeded + 1, 1.5), seedTx(B, "k-cap-b", "qp-cap-b", seeded + 1, 0));
      expect([c.code, d.code]).toEqual([0, 0]);
      expect([status(c), status(d)].sort()).toEqual(["created", "source_cap_reached"]);
      expect(psql(database, ["-c", "select count(*) from public.market_partitions where partition_key in ('market_partition_identity_v1:k-cap-a', 'market_partition_identity_v1:k-cap-b')"]).trim()).toBe("1");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  }, 180_000);
});
