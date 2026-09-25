import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261014000000_incremental_product_matching_v1.sql";
const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");
const stage2c = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261013000000_market_partition_refresh_v1.sql"), "utf8");

function jobTypesFrom(sql: string): string[] {
  const match = sql.match(/job_runs_job_type_check check \(job_type in \(([\s\S]*?)\)\);/);
  if (!match) throw new Error("job_type check constraint not found");
  return [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((entry) => entry[1]);
}

describe("Incremental Product Matching V1 migration contract (Wanterest 1B Stage 2D)", () => {
  it("sorts after every migration that preceded it (append-only history)", () => {
    const names = readdirSync(path.resolve(process.cwd(), "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
    const index = names.indexOf(migrationName);
    expect(index).toBeGreaterThan(names.indexOf("20261013000000_market_partition_refresh_v1.sql"));
    expect(names.slice(0, index).every((name) => name < migrationName)).toBe(true);
  });

  it("adds only a nullable, object-typed provenance column to the RLS-protected workspace artifact table", () => {
    expect(migration).toContain("alter table public.query_yield_artifacts\n  add column if not exists discovery_provenance jsonb;");
    expect(migration).not.toMatch(/discovery_provenance jsonb not null/);
    expect(migration).toContain("jsonb_typeof(discovery_provenance) = 'object'");
  });

  it("creates no new tables, policies, grants, or global tenant state", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration).not.toMatch(/market_partitions\b[\s\S]*workspace_id/);
    expect(migration).not.toMatch(/alter table public\.market_partition/);
  });

  it("preserves every Stage 2C job type and adds exactly the two incremental matching types", () => {
    const previous = jobTypesFrom(stage2c);
    const next = jobTypesFrom(migration);
    for (const type of previous) expect(next, type).toContain(type);
    expect(next).toEqual([...previous, "match-partition-incremental", "match-product-incremental"]);
  });

  it("performs no backfill or destructive change", () => {
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/drop table|drop column/i);
  });
});
