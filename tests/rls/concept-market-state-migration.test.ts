import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261017000000_concept_market_state_v1.sql";
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(path.join(migrationsDir, migrationName), "utf8");
const stage2g = readFileSync(path.join(migrationsDir, "20261016000000_demand_clustering_v1.sql"), "utf8");
const phase5 = readFileSync(path.join(migrationsDir, "20260923000000_phase5_actions_digests.sql"), "utf8");
const tables = ["concept_market_states", "concept_gap_states", "concept_drift_states"];

function listFrom(sql: string, constraint: string): string[] {
  const match = sql.match(new RegExp(`${constraint} check \\((?:node_type|entity_table) in \\(([\\s\\S]*?)\\)\\);`));
  if (!match) throw new Error(`${constraint} not found in given SQL`);
  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

/** phase5's original trigger_type check is an inline, unnamed column check (no `actions_trigger_type_check` constraint exists yet in that file). */
function inlineTriggerTypeList(sql: string): string[] {
  const match = sql.match(/trigger_type text not null check \(trigger_type in \(([\s\S]*?)\)\)/);
  if (!match) throw new Error("inline trigger_type check not found");
  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

/** This migration's named, additive constraint on the existing actions.trigger_type column. */
function namedTriggerTypeList(sql: string): string[] {
  const match = sql.match(/actions_trigger_type_check check \(trigger_type in \(([\s\S]*?)\)\);/);
  if (!match) throw new Error("actions_trigger_type_check not found");
  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

function tableBody(name: string): string {
  const match = migration.match(new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!match) throw new Error(`${name} not found`);
  return match[1];
}

describe("Concept market state V1 migration contract (Wanterest Layer 9C)", () => {
  it("sorts strictly after 20261016000000 and every earlier migration (append-only history)", () => {
    const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    const index = names.indexOf(migrationName);
    expect(index).toBeGreaterThan(names.indexOf("20261016000000_demand_clustering_v1.sql"));
    expect(names.slice(0, index).every((name) => name < migrationName)).toBe(true);
  });

  it("preserves every existing evidence node type, entity table and action trigger type, adding exactly the three concept-state kinds and two Action trigger types", () => {
    expect(listFrom(migration, "evidence_nodes_node_type_check")).toEqual([...listFrom(stage2g, "evidence_nodes_node_type_check"), "concept_market_state", "concept_gap_state", "concept_drift_state"]);
    expect(listFrom(migration, "evidence_nodes_entity_table_check")).toEqual([...listFrom(stage2g, "evidence_nodes_entity_table_check"), ...tables]);
    expect(namedTriggerTypeList(migration)).toEqual([...inlineTriggerTypeList(phase5), "concept_gap", "concept_drift"]);
  });

  it("makes every table workspace-owned with non-null workspace_id/product_id and a composite FK to products", () => {
    for (const name of tables) {
      const body = tableBody(name);
      expect(body, name).toContain("workspace_id uuid not null references public.workspaces(id)");
      expect(body, name).toContain("product_id uuid not null");
      expect(body, name).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
      expect(body, name).toContain("evidence_node_id uuid not null unique references public.evidence_nodes(id)");
    }
  });

  it("carries clustering_version on every table so concept identity is unambiguous across clustering versions", () => {
    for (const name of tables) {
      const body = tableBody(name);
      expect(body, name).toContain("clustering_version text not null");
      expect(body, name).toContain("anchor_concept_key text not null");
    }
    expect(tableBody("concept_market_states")).toContain("unique (workspace_id, product_id, clustering_version, anchor_concept_key, concept_market_state_policy_version, sequence)");
    expect(tableBody("concept_gap_states")).toContain("unique (workspace_id, product_id, clustering_version, anchor_concept_key, gap_state_policy_version, sequence)");
    expect(tableBody("concept_drift_states")).toContain("unique (workspace_id, product_id, clustering_version, anchor_concept_key, drift_state_policy_version, window_type, sequence)");
  });

  it("rejects cross-product and cross-workspace basis references with composite foreign keys, including the new product_snapshots key", () => {
    expect(migration).toContain("add constraint product_snapshots_workspace_product_id_key unique (workspace_id, product_id, id);");
    expect(tableBody("concept_market_states")).toContain("unique (workspace_id, product_id, id)");
    expect(tableBody("concept_gap_states")).toContain("foreign key (workspace_id, product_id, market_state_id) references public.concept_market_states(workspace_id, product_id, id)");
    expect(tableBody("concept_gap_states")).toContain("foreign key (workspace_id, product_id, product_snapshot_id) references public.product_snapshots(workspace_id, product_id, id)");
    expect(tableBody("concept_drift_states")).toContain("foreign key (workspace_id, product_id, market_state_id) references public.concept_market_states(workspace_id, product_id, id)");
  });

  it("freezes exact drift period boundaries and comparability rather than referencing arbitrary market-state totals", () => {
    const drift = tableBody("concept_drift_states");
    for (const column of ["previous_period_start", "previous_period_end", "current_period_start", "current_period_end", "comparable boolean not null", "comparability_reason", "monitoring_started_at_basis", "current_frozen_evidence_count", "previous_frozen_evidence_count", "current_frozen_source_count", "previous_frozen_source_count"]) {
      expect(drift, column).toContain(column);
    }
    // market_state_id is lineage only — the comparator's semantic input is the frozen counts above, not any market-state total.
    expect(drift).toContain("market_state_id uuid not null");
    expect(drift).not.toMatch(/current_market_state_id|previous_market_state_id/);
  });

  it("persists all three Gap statuses with a scored/gap_score consistency check", () => {
    const gap = tableBody("concept_gap_states");
    expect(gap).toContain("status text not null check (status in ('no_current_demand', 'directional', 'scored'))");
    expect(gap).toContain("check ((status = 'scored') = (gap_score is not null))");
  });

  it("enforces sequence/append-only shape and idempotency via natural-key unique constraints", () => {
    for (const name of tables) {
      expect(tableBody(name), name).toContain("check ((sequence = 1) = (previous_state_id is null))");
      expect(tableBody(name), name).toContain("input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$')");
    }
  });

  it("enables RLS with member-only select, service-role writes, and no anon access on all three tables", () => {
    expect(migration).toContain("foreach t in array array['concept_market_states', 'concept_gap_states', 'concept_drift_states'] loop");
    expect(migration).toContain("execute format('alter table public.%I enable row level security', t);");
    expect(migration).toContain("execute format('revoke all on public.%I from anon, authenticated', t);");
    expect(migration).toContain("execute format('grant select on public.%I to authenticated', t);");
    expect(migration).toContain("execute format('grant all on public.%I to service_role', t);");
    expect(migration).toContain("for select to authenticated using (public.is_workspace_member(workspace_id))");
    expect(migration).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
    expect(migration).not.toMatch(/grant (insert|update|delete|all)[^;]*to (anon|authenticated)/i);
  });

  it("makes all three tables' history immutable", () => {
    expect(migration).toContain("create trigger %I before update or delete on public.%I for each row execute function public.prevent_concept_state_mutation()");
    expect(migration).toContain("message = 'concept_market_state_history_is_immutable'");
  });

  it("extends validate_action_trigger() additively — concept_gap/concept_drift route to the new entity tables, existing branches untouched", () => {
    expect(migration).toContain("when 'demand_gap' then 'demand_gaps'");
    expect(migration).toContain("when 'demand_drift' then 'demand_drifts'");
    expect(migration).toContain("when 'demand_snapshot' then 'demand_snapshots'");
    expect(migration).toContain("when 'signal' then 'signals'");
    expect(migration).toContain("when 'concept_gap' then 'concept_gap_states'");
    expect(migration).toContain("when 'concept_drift' then 'concept_drift_states'");
  });

  it("is additive: no backfill, no destructive change, no rewrite of applied migrations", () => {
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/drop table|drop column/i);
    expect(migration).not.toMatch(/alter table public\.(demand_clusters|demand_cluster_memberships|demand_cluster_states|signals|demand_observations)/);
    for (const name of tables) expect(tableBody(name)).not.toMatch(/workspace_id uuid(?! not null)/);
    expect(stage2g).not.toContain("concept_market_state"); // the file we compare against was never touched by this migration
  });
});
