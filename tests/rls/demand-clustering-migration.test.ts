import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261016000000_demand_clustering_v1.sql";
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(path.join(migrationsDir, migrationName), "utf8");
const phase7 = readFileSync(path.join(migrationsDir, "20260925000000_phase7_experiments_operations.sql"), "utf8");
const tables = ["demand_clusters", "demand_cluster_memberships", "demand_cluster_states"];

function listFrom(sql: string, constraint: string): string[] {
  const match = sql.match(new RegExp(`${constraint} check \\((?:node_type|entity_table) in \\(([\\s\\S]*?)\\)\\);`));
  if (!match) throw new Error(`${constraint} not found`);
  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

function tableBody(name: string): string {
  const match = migration.match(new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!match) throw new Error(`${name} not found`);
  return match[1];
}

describe("Demand clustering V1 migration contract (Wanterest 1B Stage 2G)", () => {
  it("sorts after 20261015000000 and every earlier migration (append-only history)", () => {
    const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    const index = names.indexOf(migrationName);
    expect(index).toBeGreaterThan(names.indexOf("20261015000000_market_partition_adaptive_cadence_v1.sql"));
    expect(names.slice(0, index).every((name) => name < migrationName)).toBe(true);
  });

  it("preserves every existing evidence node type and entity table and adds exactly the three cluster kinds", () => {
    for (const [constraint, added] of [["evidence_nodes_node_type_check", ["demand_cluster", "demand_cluster_membership", "demand_cluster_state"]], ["evidence_nodes_entity_table_check", tables]] as const) {
      const previous = listFrom(phase7, constraint);
      expect(listFrom(migration, constraint)).toEqual([...previous, ...added]);
    }
  });

  it("makes every table workspace-owned with a non-null workspace_id and product scoping", () => {
    for (const name of tables) {
      const body = tableBody(name);
      expect(body, name).toContain("workspace_id uuid not null references public.workspaces(id)");
      expect(body, name).toContain("product_id uuid not null");
      expect(body, name).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
      expect(body, name).toContain("evidence_node_id uuid not null unique references public.evidence_nodes(id)");
    }
  });

  it("rejects cross-product and cross-workspace references with composite foreign keys", () => {
    expect(tableBody("demand_clusters")).toContain("unique (workspace_id, product_id, id)");
    expect(migration).toContain("add constraint product_match_evaluations_workspace_product_id_key unique (workspace_id, product_id, id);");
    const memberships = tableBody("demand_cluster_memberships");
    expect(memberships).toContain("foreign key (workspace_id, product_id, cluster_id) references public.demand_clusters(workspace_id, product_id, id)");
    expect(memberships).toContain("foreign key (workspace_id, product_id, match_evaluation_id) references public.product_match_evaluations(workspace_id, product_id, id)");
    expect(memberships).toContain("foreign key (workspace_id, product_match_id) references public.product_matches(workspace_id, id)");
    const states = tableBody("demand_cluster_states");
    expect(states).toContain("foreign key (workspace_id, product_id, cluster_id) references public.demand_clusters(workspace_id, product_id, id)");
    expect(states).toContain("foreign key (workspace_id, previous_state_id) references public.demand_cluster_states(workspace_id, id)");
  });

  it("enforces idempotency with natural-key unique constraints", () => {
    expect(tableBody("demand_clusters")).toContain("unique (workspace_id, product_id, clustering_version, cluster_key)");
    expect(tableBody("demand_cluster_memberships")).toContain("unique (workspace_id, product_id, clustering_version, match_evaluation_id)");
    expect(tableBody("demand_cluster_states")).toContain("unique (workspace_id, cluster_id, strength_version, sequence)");
    expect(tableBody("demand_cluster_states")).toContain("check ((sequence = 1) = (previous_state_id is null))");
  });

  it("stores version, timestamp, confidence and engine version on every derived row", () => {
    for (const name of tables) expect(tableBody(name), name).toContain("clustering_engine_version_id uuid not null references public.engine_versions(id)");
    expect(tableBody("demand_cluster_memberships")).toContain("confidence numeric not null check (confidence between 0 and 1)");
    expect(tableBody("demand_cluster_states")).toContain("input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$')");
    expect(tableBody("demand_cluster_states")).toContain("computed_at timestamptz not null");
  });

  it("enables RLS with member-only select, service-role writes, and no anon access", () => {
    expect(migration).toContain("foreach t in array array['demand_clusters', 'demand_cluster_memberships', 'demand_cluster_states'] loop");
    expect(migration).toContain("execute format('alter table public.%I enable row level security', t);");
    expect(migration).toContain("execute format('revoke all on public.%I from anon, authenticated', t);");
    expect(migration).toContain("execute format('grant select on public.%I to authenticated', t);");
    expect(migration).toContain("execute format('grant all on public.%I to service_role', t);");
    expect(migration).toContain("for select to authenticated using (public.is_workspace_member(workspace_id))");
    expect(migration).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
    expect(migration).not.toMatch(/grant (insert|update|delete|all)[^;]*to (anon|authenticated)/i);
  });

  it("makes cluster history immutable", () => {
    expect(migration).toContain("create trigger %I before update or delete on public.%I for each row execute function public.prevent_demand_cluster_history_mutation()");
    expect(migration).toContain("message = 'demand_cluster_history_is_immutable'");
  });

  it("is additive: no backfill, no destructive change, no global tenant state", () => {
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/drop table|drop column/i);
    expect(migration).not.toMatch(/alter table public\.(signals|demand_observations|demand_themes|theme_memberships|market_partitions)/);
    for (const name of tables) expect(tableBody(name)).not.toMatch(/workspace_id uuid(?! not null)/);
  });
});
