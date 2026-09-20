import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260921000000_phase3_intelligence.sql"), "utf8");

describe("Phase 3 intelligence migration contract", () => {
  it("creates the product, analysis, matching, ranking, signal, and feedback tables", () => {
    for (const table of ["products", "product_snapshots", "demand_profiles", "discovery_strategies", "conversation_analysis", "product_matches", "product_match_evaluations", "match_rankings", "match_feedback", "signals"]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("preserves immutable evaluation and ranking history with tenant-safe relationships", () => {
    expect(migration).toContain("unique (workspace_id, product_id, conversation_id)");
    expect(migration).toContain("unique (product_match_id, match_engine_version_id, input_fingerprint)");
    expect(migration).toContain("unique (product_match_evaluation_id, ranking_engine_version_id, input_fingerprint)");
    expect(migration).toContain("foreign key (workspace_id, product_match_id)");
    expect(migration).toContain("foreign key (workspace_id, product_match_evaluation_id)");
    expect(migration).toContain("products_limit_exceeded");
  });

  it("keeps global analysis private and provenance relational", () => {
    expect(migration).toContain("revoke all on public.conversation_analysis from anon, authenticated");
    expect(migration).toContain("conversation_analysis_evidence");
    expect(migration).toContain("evidence_provenance");
    expect(migration).toContain("analyze-conversations");
    expect(migration).not.toContain("demand_gaps");
    expect(migration).not.toContain("demand_drifts");
  });
});
