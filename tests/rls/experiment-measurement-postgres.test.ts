import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layer 11 real-PostgreSQL proof. Opt-in: set WANTEREST_PG_TEST_HOST (host or
 * socket dir) and optionally WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a
 * THROWAWAY local server where the test may create and drop databases. It
 * applies every repository migration to a fresh database (with minimal Supabase
 * stubs), runs the SQL scenario, and proves two-session concurrency. Never point
 * this at a shared or production database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_l11_${process.pid}`;
const root = process.cwd();
const WS = "20000000-0000-4000-8000-000000000001";
const MEMBER = "10000000-0000-4000-8000-000000000001";

function psql(db: string, args: string[]): string {
  return execFileSync("psql", ["-h", host!, "-p", port, "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
const scalar = (sql: string) => psql(database, ["-c", sql]).trim();

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
/** First session holds its transaction open; the second starts 300ms later and must wait on the lock. */
function race(first: string, second: string): Promise<[Run, Run]> {
  return Promise.all([
    psqlAsync(first),
    new Promise<Run>((resolve) => setTimeout(() => resolve(psqlAsync(second)), 300)),
  ]);
}
const tx = (body: string, sleep: number) => `set request.jwt.claim.role = 'service_role'; begin; ${body}; select pg_sleep(${sleep}); commit;`;
const guard = (action: string) => `(select guard from l11t.guards where action_id = '${action}')`;
const create = (id: string, action: string, plan: string) => `select 'EXP:' || (public.create_experiment(l11t.exp('${id}', '${action}', 'before_after', '${plan}'), '${MEMBER}', ${guard(action)})).id`;

describe.skipIf(!host)("Layer 11 experiment_measurement_v1 on real PostgreSQL", () => {
  it("applies every migration, then proves lifecycle, integrity, grants and concurrency", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }
      // Idempotent re-apply of the Layer 11 migration.
      psql(database, ["-f", path.join(root, "supabase/migrations/20261019000000_experiment_measurement_v1.sql")]);

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/experiment_measurement_postgres.sql")]);
      const checks = output.split("\n").filter((line) => line.startsWith("OK "));
      expect(checks.length).toBeGreaterThanOrEqual(90);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Concurrency fixtures: four approved Actions.
      for (const [id, concept] of [["71000000-0000-4000-8000-000000000001", "k_start_race"], ["71000000-0000-4000-8000-000000000002", "k_create_race"], ["71000000-0000-4000-8000-000000000003", "k_supersede_race"], ["71000000-0000-4000-8000-000000000004", "k_create_vs_start"]]) {
        scalar(`select set_config('request.jwt.claim.role', 'service_role', false); select l11t.action('${id}', '${concept}'); select (l11t.tx('${id}', 'proposed', 'approved')).status`);
      }

      // 1) Two sessions start the same Action (starts allowed): exactly one start, exactly one running transition.
      const A1 = "71000000-0000-4000-8000-000000000001";
      scalar(`set request.jwt.claim.role = 'service_role'; ${create("90000000-0000-4000-8000-000000000001", A1, "p1")}; select public.record_experiment_observation(l11t.obs(gen_random_uuid(), '90000000-0000-4000-8000-000000000001', 'baseline', 4, 'b', l11t.bl_end() - interval '7 days', l11t.bl_end()), 'user', '${MEMBER}'); select (public.mark_experiment_ready('${WS}', '90000000-0000-4000-8000-000000000001', '${MEMBER}')).status`);
      const start = (sleep: number) => tx(`select (l11t.tx('${A1}', 'approved', 'in_progress', '{}'::jsonb, true)).status`, sleep);
      const [s1, s2] = await race(start(1.5), start(0));
      expect(s1.code).toBe(0);
      expect(s2.code).not.toBe(0);
      expect(s2.stderr).toContain("action_status_conflict");
      expect(scalar(`select status from public.experiments where id = '90000000-0000-4000-8000-000000000001'`)).toBe("running");
      expect(scalar(`select count(*) from public.experiment_transitions where experiment_id = '90000000-0000-4000-8000-000000000001' and to_status = 'running'`)).toBe("1");
      expect(scalar(`select count(*) from public.action_events where action_id = '${A1}' and event_type = 'started'`)).toBe("1");

      // 2) Same idempotency key from two sessions with different caller UUIDs: one row, one usage, no orphan node.
      const A2 = "71000000-0000-4000-8000-000000000002";
      const [c1, c2] = await race(tx(create("90000000-0000-4000-8000-000000000002", A2, "same"), 1.5), tx(create("90000000-0000-4000-8000-000000000003", A2, "same"), 0));
      expect(c1.code).toBe(0);
      expect(c2.code).toBe(0);
      expect(c1.stdout).toContain("EXP:90000000-0000-4000-8000-000000000002");
      expect(c2.stdout).toContain("EXP:90000000-0000-4000-8000-000000000002");
      expect(scalar(`select count(*) from public.experiments where action_id = '${A2}'`)).toBe("1");
      expect(scalar(`select count(*) from public.usage_ledger where idempotency_key like 'experiment_created:90000000-0000-4000-8000-00000000000%' and idempotency_key <> 'experiment_created:90000000-0000-4000-8000-000000000001'`)).toBe("1");
      expect(scalar(`select count(*) from public.evidence_nodes where entity_id = '90000000-0000-4000-8000-000000000003'`)).toBe("0");

      //    Different plans for the same Action at once: exactly one experiment, the loser leaves nothing behind.
      scalar(`set request.jwt.claim.role = 'service_role'; select (public.cancel_experiment('${WS}', '90000000-0000-4000-8000-000000000002', '${MEMBER}', null)).closed_reason`);
      const [d1, d2] = await race(tx(create("90000000-0000-4000-8000-000000000004", A2, "plan-x"), 1.5), tx(create("90000000-0000-4000-8000-000000000005", A2, "plan-y"), 0));
      expect(d1.code).toBe(0);
      expect(d2.code).not.toBe(0);
      expect(d2.stderr).toMatch(/experiment_action_rule|experiments_one_non_terminal_per_action|duplicate key/);
      expect(scalar(`select count(*) from public.experiments where action_id = '${A2}' and status in ('draft','ready','running','paused')`)).toBe("1");
      expect(scalar(`select count(*) from public.evidence_nodes where entity_id = '90000000-0000-4000-8000-000000000005'`)).toBe("0");

      // 3) Supersession of an approved Action racing experiment creation: never a live experiment on a superseded Action.
      const A3 = "71000000-0000-4000-8000-000000000003";
      const supersede = (sleep: number) => tx(`select public.create_concept_action((select jsonb_set(jsonb_set(jsonb_set(to_jsonb(a) - 'status' - 'created_at' - 'updated_at' - 'approved_at' - 'superseded_by_action_id' - 'stale_at', '{id}', '"72000000-0000-4000-8000-000000000003"'), '{evidence_node_id}', to_jsonb(gen_random_uuid())), '{idempotency_key}', '"action:k_supersede_race:next"') || jsonb_build_object('proposal_fingerprint', repeat('9', 64), 'input_fingerprint', repeat('8', 64)) from public.actions a where a.id = '${A3}'), '${A3}', 'approved', ${guard(A3)})`, sleep);
      const [u1, u2] = await race(supersede(1.5), tx(create("90000000-0000-4000-8000-000000000006", A3, "p3"), 0));
      expect(u1.code).toBe(0);
      expect(scalar(`select status from public.actions where id = '${A3}'`)).toBe("superseded");
      expect(u2.code).not.toBe(0);
      expect(u2.stderr).toContain("experiment_action_not_approved");
      expect(scalar(`select count(*) from public.experiments e join public.actions a on a.id = e.action_id where a.status = 'superseded' and e.status in ('draft','ready','running','paused')`)).toBe("0");
      //    Reverse order: the experiment exists first, then supersession cancels it in the same transaction.
      const A3b = "71000000-0000-4000-8000-000000000005";
      scalar(`select set_config('request.jwt.claim.role', 'service_role', false); select l11t.action('${A3b}', 'k_supersede_after'); select (l11t.tx('${A3b}', 'proposed', 'approved')).status`);
      const supersedeB = (sleep: number) => tx(`select public.create_concept_action((select jsonb_set(jsonb_set(jsonb_set(to_jsonb(a) - 'status' - 'created_at' - 'updated_at' - 'approved_at' - 'superseded_by_action_id' - 'stale_at', '{id}', '"72000000-0000-4000-8000-000000000005"'), '{evidence_node_id}', to_jsonb(gen_random_uuid())), '{idempotency_key}', '"action:k_supersede_after:next"') || jsonb_build_object('proposal_fingerprint', repeat('9', 64), 'input_fingerprint', repeat('7', 64)) from public.actions a where a.id = '${A3b}'), '${A3b}', 'approved', ${guard(A3b)})`, sleep);
      const [v1, v2] = await race(tx(create("90000000-0000-4000-8000-000000000007", A3b, "p3b"), 1.5), supersedeB(0));
      expect(v1.code).toBe(0);
      expect(v2.code).toBe(0);
      expect(scalar(`select status || ':' || closed_reason from public.experiments where id = '90000000-0000-4000-8000-000000000007'`)).toBe("canceled:action_closed_before_treatment");

      // 4) Experiment creation racing the Action start: no draft/ready experiment is ever left on a started Action.
      const A4 = "71000000-0000-4000-8000-000000000004";
      const [w1, w2] = await race(tx(create("90000000-0000-4000-8000-000000000008", A4, "p4"), 1.5), tx(`select (l11t.tx('${A4}', 'approved', 'in_progress', '{}'::jsonb, true)).status`, 0));
      expect(w1.code).toBe(0);
      expect(w2.code).toBe(0);
      expect(scalar(`select status || ':' || closed_reason from public.experiments where id = '90000000-0000-4000-8000-000000000008'`)).toBe("canceled:treatment_started_before_registration");
      expect(scalar(`select count(*) from public.experiments e join public.actions a on a.id = e.action_id where a.status = 'in_progress' and e.status in ('draft','ready')`)).toBe("0");

      // 5) Two measurement passes finalize the same experiment with the same input: one result revision.
      scalar(`select l11t.age('90000000-0000-4000-8000-000000000001', 8)`);
      const finalize = (id: string, sleep: number) => tx(`select 'REV:' || (public.finalize_experiment_outcome('${WS}', '90000000-0000-4000-8000-000000000001', l11t.result('${id}', repeat('5', 64), 'inconclusive') || '{"evidence_completeness":"missing","effect":null}', true, '{}')).revision`, sleep);
      const [f1, f2] = await race(finalize("91000000-0000-4000-8000-000000000001", 1.5), finalize("91000000-0000-4000-8000-000000000002", 0));
      expect(f1.code).toBe(0);
      expect(f2.code).toBe(0);
      expect(f1.stdout).toContain("REV:1");
      expect(f2.stdout).toContain("REV:1");
      expect(scalar(`select count(*) from public.experiment_results where experiment_id = '90000000-0000-4000-8000-000000000001'`)).toBe("1");
      expect(scalar(`select count(*) from public.experiment_transitions where experiment_id = '90000000-0000-4000-8000-000000000001' and to_status = 'completed'`)).toBe("1");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  }, 180_000);
});
