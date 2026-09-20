import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925000000_phase7_experiments_operations.sql"), "utf8");

describe("Phase 7 migration contract", () => {
  it("defines the bounded experiment domain and immutable result/event boundaries", () => {
    expect(migration).toContain("create table if not exists public.experiments");
    expect(migration).toContain("create table if not exists public.experiment_variants");
    expect(migration).toContain("create table if not exists public.experiment_assignments");
    expect(migration).toContain("create table if not exists public.experiment_events");
    expect(migration).toContain("create table if not exists public.experiment_results");
    expect(migration).toContain("experiment_events_append_only");
    expect(migration).toContain("experiment_results_append_only");
    expect(migration).toContain("deterministic_hash_v1");
    expect(migration).toContain("unique (experiment_id, external_event_id)");
  });

  it("protects the public boundary and tenant integrity", () => {
    expect(migration).toContain("create table if not exists public.experiment_public_tokens");
    expect(migration).toContain("token_hash text not null");
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
    expect(migration).toContain("foreign key (workspace_id, action_id) references public.actions(workspace_id, id)");
    expect(migration).toContain("revoke all on public.experiment_events from anon, authenticated");
    expect(migration).toContain("grant execute on function public.consume_phase7_rate_limit");
    expect(migration.toLowerCase()).not.toMatch(/arbitrary\s+javascript|eval\s*\(/);
  });
});
