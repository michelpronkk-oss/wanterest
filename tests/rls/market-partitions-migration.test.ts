import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261012000000_market_partitions_v1.sql"), "utf8");

describe("Market Partitions V1 migration contract (Wanterest 1B Stage 2B)", () => {
  it("creates a global, tenant-free, append-only market_partitions table", () => {
    expect(migration).toContain("create table if not exists public.market_partitions");
    expect(migration).toContain("partition_key text not null unique");
    expect(migration).toContain("identity_version text not null");
    expect(migration).toContain("source_key text not null check (source_key ~ '^[a-z][a-z0-9_-]*$')");
    expect(migration).toContain("retrieval_spec jsonb not null");
    // No workspace_id/product_id column anywhere in the table definition.
    expect(migration).not.toMatch(/create table if not exists public\.market_partitions[\s\S]*?workspace_id/);
    expect(migration).not.toMatch(/create table if not exists public\.market_partitions[\s\S]*?product_id/);
  });

  it("is append-only via a mutation-preventing trigger", () => {
    expect(migration).toContain("prevent_market_partition_mutation");
    expect(migration).toContain("market_partitions_are_append_only");
    expect(migration).toContain("before update or delete on public.market_partitions");
  });

  it("enables RLS and denies anon/authenticated entirely", () => {
    expect(migration).toContain("alter table public.market_partitions enable row level security");
    expect(migration).toContain("revoke all on public.market_partitions from anon, authenticated");
    expect(migration).not.toContain("create policy market_partitions");
  });

  it("grants service_role select and insert only", () => {
    expect(migration).toContain("grant select, insert on public.market_partitions to service_role");
    expect(migration).not.toContain("grant update on public.market_partitions");
    expect(migration).not.toContain("grant delete on public.market_partitions");
  });

  it("adds nullable, non-breaking columns to query_yield_artifacts with no foreign key to market_partitions", () => {
    expect(migration).toContain("add column if not exists market_partition_key text");
    expect(migration).toContain("add column if not exists market_partition_ineligible_reason text");
    expect(migration).toContain("add column if not exists raw_new_items integer");
    expect(migration).not.toContain("references public.market_partitions");
  });

  it("does not backfill any existing row", () => {
    expect(migration).not.toMatch(/update\s+public\.query_yield_artifacts/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.market_partitions/i);
  });
});
