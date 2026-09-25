import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261013000000_market_partition_refresh_v1.sql"), "utf8");
const phase7 = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260925000000_phase7_experiments_operations.sql"), "utf8");

function jobTypesFrom(sql: string): string[] {
  const match = sql.match(/job_runs_job_type_check check \(job_type in \(([\s\S]*?)\)\);/);
  if (!match) throw new Error("job_type check constraint not found");
  return [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((entry) => entry[1]);
}

describe("Market Partition Refresh V1 migration contract (Wanterest 1B Stage 2C)", () => {
  it("creates a global, workspace/product-free refresh state table referencing immutable market_partitions", () => {
    expect(migration).toContain("create table if not exists public.market_partition_refresh_state");
    expect(migration).toContain("partition_id uuid primary key references public.market_partitions(id)");
    expect(migration).not.toMatch(/create table if not exists public\.market_partition_refresh_state[\s\S]*?workspace_id/);
    expect(migration).not.toMatch(/create table if not exists public\.market_partition_refresh_state[\s\S]*?product_id/);
    for (const column of ["source_key", "enabled", "disabled_reason", "next_due_at", "lease_token", "lease_expires_at", "last_attempt_at", "last_success_at", "last_failure_at", "consecutive_failures", "last_job_run_id"]) {
      expect(migration, column).toContain(column);
    }
  });

  it("indexes due selection and lease expiry", () => {
    expect(migration).toContain("market_partition_refresh_state_due_idx");
    expect(migration).toContain("on public.market_partition_refresh_state (enabled, next_due_at)");
    expect(migration).toContain("market_partition_refresh_state_lease_idx");
    expect(migration).toContain("on public.market_partition_refresh_state (lease_expires_at)");
  });

  it("enables RLS and denies anon/authenticated, service_role only", () => {
    expect(migration).toContain("alter table public.market_partition_refresh_state enable row level security");
    expect(migration).toContain("revoke all on public.market_partition_refresh_state from anon, authenticated");
    expect(migration).toContain("grant select, insert, update on public.market_partition_refresh_state to service_role");
    expect(migration).not.toContain("create policy market_partition_refresh_state");
  });

  it("creates a service-role-enforced claim RPC", () => {
    expect(migration).toContain("create or replace function public.claim_market_partition_refresh");
    expect(migration).toContain("security definer");
    expect(migration).toContain("public.is_service_role()");
    expect(migration).toContain("service_role_required");
    expect(migration).toContain("grant execute on function public.claim_market_partition_refresh");
  });

  it("preserves every previously allowed job_type and adds only refresh-market-partition", () => {
    const previousTypes = jobTypesFrom(phase7);
    const newTypes = jobTypesFrom(migration);
    for (const type of previousTypes) expect(newTypes, type).toContain(type);
    expect(newTypes).toContain("refresh-market-partition");
    expect(newTypes).toHaveLength(previousTypes.length + 1);
  });

  it("performs no backfill", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.market_partition_refresh_state/i);
  });
});
