import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static contract for 20261019000000_experiment_measurement_v1.sql. The
 * behaviour itself is proven on real PostgreSQL by
 * experiment-measurement-postgres.test.ts (opt-in).
 */
const migration = readFileSync("supabase/migrations/20261019000000_experiment_measurement_v1.sql", "utf8");
const fn = (name: string) => {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("\n$$;", start));
};

const RPCS = [
  "create_experiment(jsonb, uuid, jsonb)", "update_experiment_draft(uuid, uuid, uuid, jsonb)", "add_experiment_variant(uuid, uuid, uuid, jsonb)",
  "mark_experiment_ready(uuid, uuid, uuid)", "cancel_experiment(uuid, uuid, uuid, text)", "record_experiment_observation(jsonb, text, uuid)",
  "issue_experiment_token(uuid, uuid, uuid, uuid, text, text)", "revoke_experiment_token(uuid, uuid, uuid)", "experiment_arm_counts(uuid, uuid)",
  "experiments_due_for_measurement(timestamptz, integer)", "finalize_experiment_outcome(uuid, uuid, jsonb, boolean, uuid[])",
  "transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, boolean)",
];

describe("Layer 11 migration contract", () => {
  it("sorts after Layer 10, is additive, and leaves 20261018000000 byte-identical to its committed version", () => {
    const files = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
    expect(files.indexOf("20261019000000_experiment_measurement_v1.sql")).toBe(files.indexOf("20261018000000_actions_lifecycle_v1.sql") + 1);
    expect(migration).not.toMatch(/\bdrop table\b/i);
    expect(migration).not.toMatch(/\bdelete from\b/i);
    const committed = execFileSync("git", ["show", "HEAD:supabase/migrations/20261018000000_actions_lifecycle_v1.sql"], { encoding: "utf8" });
    expect(readFileSync("supabase/migrations/20261018000000_actions_lifecycle_v1.sql", "utf8")).toBe(committed);
  });

  it("every RPC is service-role only (revoked from public/anon/authenticated) and security invoker", () => {
    for (const rpc of RPCS) {
      expect(migration, rpc).toContain(`revoke all on function public.${rpc} from public, anon, authenticated;`);
      expect(migration, rpc).toContain(`grant execute on function public.${rpc} to service_role;`);
    }
    expect(migration).not.toMatch(/security definer/i);
    expect(migration.match(/security invoker/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
  });

  it("new tables are workspace-scoped, RLS member-read only, append-only, with composite FKs", () => {
    for (const table of ["experiment_transitions", "experiment_observations"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated;`);
      expect(migration).toContain(`grant select on public.${table} to authenticated;`);
      expect(migration).toMatch(new RegExp(`create policy ${table}_member_select on public\\.${table} for select to authenticated\\s+using \\(public\\.is_workspace_member\\(workspace_id\\)\\)`));
      expect(migration).toContain(`create trigger ${table}_append_only before update or delete on public.${table}`);
      expect(migration).toContain(`foreign key (workspace_id, experiment_id) references public.experiments(workspace_id, id)`);
    }
    expect(migration).toContain("unique (experiment_id, idempotency_key)");
    expect(migration).toContain("unique (supersedes_observation_id)");
    expect(migration).toContain("check ((source = 'wanterest_internal') = (metric_key = 'market_evidence_count'))");
    expect(migration).not.toContain("drop trigger if exists experiment_results_append_only"); // Phase 7 append-only trigger stays in place
  });

  it("plan and outcome checks fail closed: a missing field is a violation, never a NULL pass", () => {
    expect(migration).toMatch(/measurement_policy_version is null\s+or coalesce\(\(/);
    expect(migration).toMatch(/outcome_version is null\s+or coalesce\(\(/);
    expect(migration).toContain("(success_criterion->>'minimumEffect')::numeric > 0");
    expect(migration).toContain("(success_criterion->>'minSamplePerArm')::integer >= 1");
    expect(migration).toContain("and (outcome <> 'invalid' or invalidation_reason is not null)");
    expect(migration).toContain("'canceled_before_treatment', 'treatment_started_before_registration', 'measurement_disabled_at_treatment',");
  });

  it("one experiment per Action, idempotent creation, and controlled event integrity are database-enforced", () => {
    expect(migration).toContain("create unique index if not exists experiments_workspace_idempotency_key");
    expect(migration).toContain("create unique index if not exists experiments_one_non_terminal_per_action");
    expect(migration).toContain("create trigger experiments_enforce_action_rule before insert on public.experiments");
    expect(fn("enforce_experiment_action_rule")).toContain("e.closed_reason is distinct from 'canceled_before_treatment'");
    expect(fn("create_experiment")).toContain("pg_advisory_xact_lock");
    expect(fn("create_experiment")).toContain("perform public.consume_usage(v_new.workspace_id, 'experiment_created'");
    expect(fn("create_experiment")).toContain("'derived_from_action'");
    expect(migration).toContain("foreign key (workspace_id, experiment_id, assignment_id, variant_id, subject_key_hash)");
    // Drop the dependent FK before the unique key it references (idempotent re-apply).
    expect(migration.indexOf("drop constraint if exists experiment_events_assignment_subject_fkey")).toBeLessThan(migration.indexOf("drop constraint if exists experiment_assignments_subject_link_key"));
    expect(fn("enforce_experiment_v1_collection")).toContain("experiment_event_outside_window");
  });

  it("the single start path defaults closed and reconciliation lives in one Action trigger", () => {
    expect(fn("transition_action")).toContain("p_experiment_starts_allowed boolean default false");
    expect(fn("transition_action")).toContain("set_config('wanterest.experiment_starts_allowed'");
    expect(fn("transition_action")).toContain("treatment_live_since_required");
    expect(migration).toContain("drop function if exists public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text);");
    expect(migration).toContain("create trigger actions_reconcile_experiments after update of status on public.actions");
    const reconcile = fn("reconcile_action_experiments");
    for (const reason of ["treatment_started_before_registration", "measurement_disabled_at_treatment", "action_closed_before_treatment", "treatment_abandoned", "experiment_state_conflict"]) expect(reconcile).toContain(reason);
    expect(reconcile).toContain("current_setting('wanterest.experiment_starts_allowed', true)");
  });

  it("v1 has no pause, a frozen plan, bounded writes, and append-only results keyed by input fingerprint", () => {
    expect(fn("validate_experiment_transition")).toContain("experiment_pause_not_supported");
    expect(migration).toContain("create trigger experiments_freeze_plan before update on public.experiments");
    expect(fn("record_experiment_observation")).toContain(">= 200");
    expect(fn("finalize_experiment_outcome")).toContain("v_revision > 100");
    expect(fn("experiments_due_for_measurement")).toContain("limit least(greatest(coalesce(p_limit, 50), 1), 50)");
    expect(migration).toContain("create unique index if not exists experiment_results_input_fingerprint_key");
    expect(fn("revoke_experiment_token")).toMatch(/update public\.experiment_public_tokens set status = 'revoked'[\s\S]*where workspace_id = p_workspace_id and id = p_token_id/);
  });

  it("the architecture decision is recorded before the code", () => {
    const doc = readFileSync("docs/architecture.md", "utf8");
    expect(doc).toContain("## 23. Layer 11 — Experiments / Measurement (`experiment_measurement_v1`)");
    expect(doc).toContain("p_experiment_starts_allowed boolean default false");
  });
});
