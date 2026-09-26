import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 12A.3A.1 Amendment IV (signal_revalidation_preview_v1) real-PostgreSQL no-write proof.
 * Opt-in: set WANTEREST_PG_TEST_HOST (host or socket dir) and optionally
 * WANTEREST_PG_TEST_PORT / WANTEREST_PG_TEST_USER to a THROWAWAY local server where
 * the test may create and drop databases. It applies every repository migration to a
 * fresh database, seeds one fully-materialized signal (through cluster membership),
 * checksums every table the preview reads from, simulates the preview's exact
 * read-only query sequence, and requires the checksums to be byte-for-byte identical
 * afterward. Never point this at a shared or production database.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_l12pt_${process.pid}`;
const root = process.cwd();

function psql(db: string, args: string[], input?: string): string {
  return execFileSync("psql", ["-h", host!, "-p", port, "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

describe.skipIf(!host)("12A.3A.1 Amendment IV signal_revalidation_preview_v1 on real PostgreSQL", () => {
  it("applies every migration, seeds one materialized signal through cluster membership, and proves the preview's exact read sequence leaves every table byte-for-byte unchanged", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }

      const output = psql(database, ["-f", path.join(root, "tests/rls/sql/signal_revalidation_preview_postgres.sql")]);
      const checks = output.split("\n").filter((line) => line.startsWith("OK "));
      expect(checks.length).toBeGreaterThanOrEqual(1);
      expect(output).toContain("ALL_CHECKS_PASSED");

      // Re-affirm directly: the seeded signal and its evaluation/match/cluster/membership rows
      // are exactly as seeded, with no stray inserts anywhere in scope.
      expect(psql(database, ["-c", "select count(*) from public.signals"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.product_match_evaluations"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.demand_cluster_memberships"]).trim()).toBe("1");
      expect(psql(database, ["-c", "select count(*) from public.semantic_shadow_reasoning"]).trim()).toBe("0");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  });
});
