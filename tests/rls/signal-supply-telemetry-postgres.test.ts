import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layer 12A.1 real-PostgreSQL proof. Opt-in: set WANTEREST_PG_TEST_HOST (host or
 * socket dir) and optionally WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a
 * THROWAWAY local server where the test may create and drop databases. Never
 * point this at a shared or production database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_s12_${process.pid}`;
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

describe.skipIf(!host)("Layer 12A.1 signal_supply_telemetry_v1 on real PostgreSQL", () => {
  it("applies every migration, then proves grants, RLS, constraints, idempotency, funnel aggregation and concurrent writers", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }
      psql(database, ["-f", path.join(root, "supabase/migrations/20261020000000_signal_supply_telemetry_v1.sql")]);

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/signal_supply_telemetry_postgres.sql")]);
      expect(output.split("\n").filter((line) => line.startsWith("OK ")).length).toBeGreaterThanOrEqual(35);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Concurrent duplicate writers for the same job identity converge on exactly one immutable row.
      psql(database, ["-c", "insert into public.job_runs (id, job_type, idempotency_key, trace_id, workspace_id, product_id, status) values ('50000000-0000-4000-8000-000000000099', 'refresh-market-partition', 'r-race', 't', null, null, 'succeeded'), ('50000000-0000-4000-8000-000000000098', 'match-product-incremental', 'm-race', 't', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'succeeded')"]);
      const write = (raw: number, sleep: number) => `begin; select s12t.refresh('50000000-0000-4000-8000-000000000099', '40000000-0000-4000-8000-000000000001', 'github', ${raw}, 1, 1, 1, null, 'unknown', now()); select s12t.product('50000000-0000-4000-8000-000000000098', '50000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', ${raw}, 1, 1, 1, 0, 0, now()); select pg_sleep(${sleep}); commit;`;
      const [a, b] = await Promise.all([
        psqlAsync(write(7, 1.5)),
        new Promise<Run>((resolve) => setTimeout(() => resolve(psqlAsync(write(9, 0))), 300)),
      ]);
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);
      expect(psql(database, ["-c", "select count(*) || ':' || max(raw_count) from public.supply_refresh_facts where job_run_id = '50000000-0000-4000-8000-000000000099'"]).trim()).toBe("1:7");
      expect(psql(database, ["-c", "select count(*) || ':' || max(candidate_count) from public.product_supply_facts where job_run_id = '50000000-0000-4000-8000-000000000098'"]).trim()).toBe("1:7");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  }, 180_000);
});
