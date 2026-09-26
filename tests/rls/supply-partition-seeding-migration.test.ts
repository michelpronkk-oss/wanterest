import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static contract for 20261021000000_supply_partition_seeding_v1.sql (behaviour proven on real Postgres). */
const name = "20261021000000_supply_partition_seeding_v1.sql";
const migration = readFileSync(`supabase/migrations/${name}`, "utf8");

describe("Layer 12A.2 migration contract", () => {
  it("sorts directly after 12A.1, is additive and backfills nothing", () => {
    const files = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort();
    expect(files.indexOf(name)).toBe(files.indexOf("20261020000000_signal_supply_telemetry_v1.sql") + 1);
    expect(files.at(-1)).toBe(name);
    expect(migration).not.toMatch(/\bdrop table\b|\bdelete from\b|\bdrop column\b|\btruncate\b/i);
    expect(migration).not.toMatch(/alter table public\.(market_partitions|query_yield_artifacts|supply_refresh_facts|product_supply_facts|product_match_evaluations|signals)\b/i);
    expect(migration).not.toMatch(/insert into public\.market_partition_interests\s*\([^)]*\)\s*select/i);
    // market_partitions stays append-only: seeding inserts-or-ignores, never updates.
    expect(migration).toContain("on conflict (partition_key) do nothing");
    expect(migration).not.toMatch(/update public\.market_partitions\b/i);
  });

  it("interests are workspace-scoped with RLS, composite product FK, required self-consistent provenance and one identity per product/partition", () => {
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade");
    expect(migration).toContain("unique (workspace_id, product_id, market_partition_id)");
    expect(migration).toContain("provenance jsonb not null");
    expect(migration).toContain("check (provenance->>'queryPlanId' = query_plan_id)");
    expect(migration).toContain("check (provenance->>'source' = source_key)");
    expect(migration).toMatch(/create policy market_partition_interests_member_select on public\.market_partition_interests for select to authenticated\s+using \(public\.is_workspace_member\(workspace_id\)\)/);
    expect(migration).toContain("revoke all on public.market_partition_interests from public, anon, authenticated;");
    expect(migration).not.toMatch(/grant (insert|update|delete)[a-z, ]* on public\.market_partition_interests to authenticated/i);
    expect(migration).not.toMatch(/security definer/i);
  });

  it("retirement is additive on refresh state and fails closed without 12A.1 facts", () => {
    expect(migration).toContain("add column if not exists retired_at timestamptz");
    expect(migration).toContain("add column if not exists retired_reason text");
    expect(migration).toMatch(/from public\.supply_refresh_facts f/);
    expect(migration).toMatch(/count\(\*\) = v_min/);
    for (const fn of ["upsert_market_partition_interest", "active_market_partition_interests", "retire_exhausted_seed_partitions"]) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });
});
