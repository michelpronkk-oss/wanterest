import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261015000000_market_partition_adaptive_cadence_v1.sql"), "utf8");

describe("Market Partition Adaptive Cadence V1 migration contract (Stage 2F)", () => {
  it("adds only additive cadence columns to the global refresh state", () => {
    for (const column of ["consecutive_zero_new integer not null default 0", "last_raw_items integer", "last_raw_new_items integer", "last_cadence_seconds integer", "cadence_policy_version text"]) {
      expect(migration).toContain(`add column if not exists ${column}`);
    }
    expect(migration).toContain("market_partition_refresh_state_cadence_check");
  });

  it("introduces no tenant columns, grants, policies, tables, or backfill", () => {
    expect(migration).not.toMatch(/workspace_id|product_id/);
    expect(migration).not.toMatch(/\bgrant\b|create policy|create table/i);
    expect(migration).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|drop table|drop column/i);
  });

  it("indexes the rolling daily-budget lookup", () => {
    expect(migration).toContain("job_runs_refresh_market_partition_created_idx");
    expect(migration).toContain("where job_type = 'refresh-market-partition'");
  });
});
