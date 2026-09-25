import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261018000000_actions_lifecycle_v1.sql";
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(path.join(migrationsDir, migrationName), "utf8").replace(/\r\n/g, "\n");
const functions = [
  "concept_latest_market_states(uuid, uuid, text, text, integer)",
  "concept_latest_gap_states(uuid, uuid, text, text, integer)",
  "concept_latest_drift_states(uuid, uuid, text, text, text, integer)",
  "assert_concept_action_basis_guard(uuid, uuid, text, text, jsonb)",
  "create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text)",
  "transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text)",
];

function listIn(constraint: string): string[] {
  const match = migration.match(new RegExp(`add constraint ${constraint} check \\([a-z_]+ in \\(([\\s\\S]*?)\\)\\);`));
  if (!match) throw new Error(`${constraint} not found`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
}

describe("Layer 10 actions_lifecycle_v1 migration contract", () => {
  it("sorts strictly after the latest applied migration (append-only history)", () => {
    const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    // Later layers append after it (Layer 11: 20261019000000); history is never rewritten.
    expect(names.slice(names.indexOf(migrationName) + 1).every((name) => name > migrationName)).toBe(true);
    expect(names.indexOf(migrationName)).toBeGreaterThan(names.indexOf("20261017000000_concept_market_state_v1.sql"));
  });

  it("adds expired status and expired/revalidated events without dropping any existing value", () => {
    expect(listIn("actions_status_check")).toEqual(["proposed", "approved", "in_progress", "completed", "dismissed", "superseded", "expired"]);
    expect(listIn("action_events_event_type_check")).toEqual(["approved", "dismissed", "started", "completed", "superseded", "regenerated", "expired", "revalidated"]);
  });

  it("adds nullable concept identity columns with a concept-only identity check", () => {
    expect(migration).toContain("alter table public.actions add column if not exists trigger_clustering_version text;");
    expect(migration).toContain("alter table public.actions add column if not exists proposal_fingerprint text;");
    const check = migration.slice(migration.indexOf("add constraint actions_concept_identity_check"), migration.indexOf("-- 5."));
    expect(check).toContain("when trigger_type in ('concept_gap', 'concept_drift') then");
    expect(check).toContain("trigger_clustering_version is not null");
    expect(check).toContain("proposal_fingerprint ~ '^[0-9a-f]{64}$'");
    expect(check).toMatch(/else\s+trigger_clustering_version is null\s+and proposal_fingerprint is null/);
  });

  it("validate_action_trigger keeps the evidence-node check and verifies concept identity against the persisted basis", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.validate_action_trigger()"), migration.indexOf("drop trigger if exists actions_validate_trigger"));
    expect(fn).toContain("'action_trigger_evidence_mismatch'");
    for (const table of ["concept_gap_states", "concept_drift_states"]) expect(fn).toContain(`from public.${table} s`);
    expect(fn).toContain("s.clustering_version = new.trigger_clustering_version and s.anchor_concept_key = new.trigger_concept_key");
    expect(fn).toContain("'action_concept_identity_mismatch'");
    expect(migration).toMatch(/before insert or update of [^\n]*trigger_clustering_version, trigger_concept_key/);
  });

  it("makes the two new fields immutable generated fields", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.prevent_action_generated_mutation()"), migration.indexOf("-- 7."));
    expect(fn).toContain("new.trigger_clustering_version is distinct from old.trigger_clustering_version");
    expect(fn).toContain("new.proposal_fingerprint is distinct from old.proposal_fingerprint");
  });

  it("one open Action per canonical concept incl. clustering version, cross-type (trigger_type NOT in the key)", () => {
    const index = migration.slice(migration.indexOf("create unique index if not exists actions_one_open_concept_action"), migration.indexOf("create index if not exists actions_concept_history_idx"));
    expect(index).toContain("on public.actions (workspace_id, product_id, trigger_clustering_version, trigger_concept_key)");
    expect(index).toContain("where trigger_type in ('concept_gap', 'concept_drift')");
    expect(index).toContain("and status in ('proposed', 'approved', 'in_progress')");
  });

  it("latest-state functions are DB-side bounded (DISTINCT ON + limit <= 500)", () => {
    for (const table of ["concept_market_states", "concept_gap_states", "concept_drift_states"]) {
      const start = migration.indexOf(`returns setof public.${table}`);
      const body = migration.slice(start, migration.indexOf("$$;", start));
      expect(body).toContain("select distinct on (s.anchor_concept_key) s.*");
      expect(body).toContain("order by s.anchor_concept_key, s.sequence desc");
      expect(body).toContain("limit least(greatest(coalesce(p_limit, 500), 1), 500)");
    }
  });

  it("create_concept_action resolves replays by (workspace_id, idempotency_key) before writing, under an advisory lock, and consumes usage once", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.create_concept_action("), migration.indexOf("-- 9."));
    const lock = fn.indexOf("pg_advisory_xact_lock");
    const resolve = fn.indexOf("where workspace_id = v_input.workspace_id and idempotency_key = v_input.idempotency_key");
    const insertNode = fn.indexOf("insert into public.evidence_nodes");
    expect(fn.indexOf("for update")).toBeLessThan(lock);
    expect(lock).toBeLessThan(resolve);
    expect(resolve).toBeLessThan(insertNode);
    expect(fn).toContain("perform public.assert_concept_action_basis_guard(");
    expect(fn).toContain("'action_status_conflict'");
    expect(fn).toContain("superseded_by_action_id = v_new.id");
    expect(fn).toContain("'triggered_by'");
    expect(fn).toContain("'supersedes_action'");
    expect(fn.match(/perform public\.consume_usage\(/g)).toHaveLength(1);
    expect(fn).toContain("'action_generated:' || v_new.id::text");
  });

  it("transition_action is compare-and-set, enforces the lifecycle matrix, guards approve/start, and writes event + audit together", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.transition_action("), migration.indexOf("revoke all on function"));
    expect(fn).toContain("for update");
    expect(fn).toContain("where workspace_id = p_workspace_id and id = p_action_id and status = p_from");
    expect(fn).toContain("(p_from = 'in_progress' and p_to in ('completed', 'dismissed'))");
    expect(fn).toContain("'action_transition_system_only'");
    expect(fn).toContain("wm.role in ('owner', 'admin', 'member')");
    expect(fn).toContain("if v_concept and p_to in ('approved', 'in_progress') then");
    expect(fn).toContain("insert into public.action_events");
    expect(fn).toContain("perform public.record_audit_event(");
  });

  it("every new function is revoked from public/anon/authenticated and granted to service_role only", () => {
    for (const signature of functions) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(migration).not.toMatch(/grant execute on function [^;]* to (anon|authenticated)/);
    expect(migration).not.toMatch(/security definer/);
  });

  it("is additive: no drop table/column, no delete, no rewrite of existing rows", () => {
    expect(migration).not.toMatch(/drop table|drop column|delete from|truncate|update public\.actions set status = 'expired'/i);
  });
});
