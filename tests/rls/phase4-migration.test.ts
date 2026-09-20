import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260922000000_phase4_demand_intelligence.sql"), "utf8");

describe("Phase 4 demand intelligence migration contract", () => {
  it("creates immutable observations, themes, map, gap, and drift tables", () => {
    for (const table of ["demand_observations", "demand_themes", "theme_memberships", "demand_snapshots", "demand_snapshot_themes", "demand_snapshot_phrases", "demand_snapshot_alternatives", "demand_snapshot_intents", "demand_gaps", "demand_drifts", "demand_drift_phrases", "demand_drift_alternatives"]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain("t || '_immutable'");
    }
  });

  it("enforces tenant integrity with composite foreign keys and replay fingerprints", () => {
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
    expect(migration).toContain("foreign key (workspace_id, match_evaluation_id) references public.product_match_evaluations(workspace_id, id)");
    expect(migration).toContain("foreign key (workspace_id, demand_snapshot_id) references public.demand_snapshots(workspace_id, id)");
    expect(migration).toContain("unique (workspace_id, product_id, demand_snapshot_id, product_snapshot_id, concept_key, gap_engine_version_id, input_fingerprint)");
    expect(migration).toContain("unique (workspace_id, current_snapshot_id, previous_snapshot_id, concept_key, drift_engine_version_id, input_fingerprint)");
    expect(migration).toContain("source_key text not null");
  });

  it("adds only Phase 4 jobs and keeps raw provenance relational", () => {
    expect(migration).toContain("'aggregate-demand'");
    expect(migration).toContain("'calculate-demand-gap'");
    expect(migration).toContain("'calculate-demand-drift'");
    expect(migration).toContain("'backfill-demand-snapshots'");
    expect(migration).toContain("evidence_node_id uuid not null unique references public.evidence_nodes(id)");
    expect(migration).not.toContain("create table if not exists public.actions");
  });
});
