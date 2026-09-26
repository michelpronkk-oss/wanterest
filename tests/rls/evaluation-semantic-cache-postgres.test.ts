import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 12A.3A.1 Amendment III (evaluation_semantic_cache_v2) real-PostgreSQL proof.
 * Opt-in: set WANTEREST_PG_TEST_HOST (host or socket dir) and optionally
 * WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a THROWAWAY local server
 * where the test may create and drop databases. It applies every repository
 * migration to a fresh database (with minimal Supabase stubs), runs the SQL
 * scenario proving the unique constraint + immutability trigger, then proves
 * two real concurrent sessions racing an identical fingerprint insert cannot
 * both create a "current" row. Never point this at a shared or production
 * database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_l12ct_${process.pid}`;
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

describe.skipIf(!host)("12A.3A.1 Amendment III evaluation_semantic_cache_v2 on real PostgreSQL", () => {
  it("applies every migration, proves the unique-fingerprint constraint + history immutability, then proves concurrent identical-fingerprint inserts cannot both create a current row", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/evaluation_semantic_cache_postgres.sql")]);
      const checks = output.split("\n").filter((line) => line.startsWith("OK "));
      expect(checks.length).toBeGreaterThanOrEqual(6);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Two concurrent sessions computing the IDENTICAL new fingerprint ("F3") for the
      // same product_match/engine_version - simulating two workers replaying the same
      // semantic result at once. Exactly one may create the "current" row; the DB's
      // own unique constraint (not application locking) is what makes this safe -
      // matching IntelligenceRepository.createEvaluation()'s existing 23505 retry path.
      const race = (evidenceNodeId: string, evaluationId: string, sleepSeconds: number) => `
        set request.jwt.claim.role = 'service_role';
        begin;
        insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
          values ('${evidenceNodeId}', 'match_evaluation', '20000000-0000-4000-8000-000000000001', 'product_match_evaluations', '${evaluationId}');
        insert into public.product_match_evaluations (id, workspace_id, product_match_id, product_id, conversation_id, demand_profile_id, conversation_analysis_id, match_engine_version_id, evidence_node_id, input_fingerprint, match_confidence, rationale, evidence, decision)
          values ('${evaluationId}', '20000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '${evidenceNodeId}', repeat('3', 64), 0.95, 'Concurrent replay of the same fresh semantic result (fingerprint F3).', '{}'::jsonb, 'qualified');
        select pg_sleep(${sleepSeconds});
        commit;
      `;
      const [winner, loser] = await Promise.all([
        psqlAsync(race("49000000-0000-4000-8000-000000000001", "48000000-0000-4000-8000-000000000004", 1.5)),
        new Promise<Awaited<ReturnType<typeof psqlAsync>>>((resolve) => setTimeout(() => resolve(psqlAsync(race("49000000-0000-4000-8000-000000000002", "48000000-0000-4000-8000-000000000005", 0))), 300)),
      ]);
      expect(winner.code).toBe(0);
      expect(loser.code).not.toBe(0);
      expect(loser.stderr).toMatch(/duplicate key|23505/);
      expect(psql(database, ["-c", "select count(*) from public.product_match_evaluations where product_match_id = '47000000-0000-4000-8000-000000000001' and input_fingerprint = repeat('3', 64)"]).trim()).toBe("1");

      // The current pointer can safely move to the surviving row - no duplicate "current" evaluation exists.
      psql(database, ["-c", "update public.product_matches set current_match_evaluation_id = '48000000-0000-4000-8000-000000000004' where id = '47000000-0000-4000-8000-000000000001';"]);
      expect(psql(database, ["-c", "select current_match_evaluation_id from public.product_matches where id = '47000000-0000-4000-8000-000000000001'"]).trim()).toBe("48000000-0000-4000-8000-000000000004");

      // All three earlier historical rows (F1 old-failed, F2 fresh-success, F3 race-winner) remain present -
      // nothing was deleted or rewritten by any of the above.
      expect(psql(database, ["-c", "select count(*) from public.product_match_evaluations where product_match_id = '47000000-0000-4000-8000-000000000001'"]).trim()).toBe("3");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  });
});
