import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260921000000_phase3_intelligence.sql"), "utf8");
const privilegeCorrection = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260928000000_phase3_service_role_privilege_correction.sql"), "utf8");
const digestCorrection = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260929000000_phase3_create_product_digest_schema_fix.sql"), "utf8");

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
    expect(digestCorrection).toContain("count(*) from public.products where workspace_id = p_workspace_id and status = 'active'");
  });

  it("supports archive lifecycle without deleting product history", () => {
    expect(migration).toContain("status text not null default 'active' check (status in ('active', 'archived'))");
    expect(migration).toContain("count(*) from public.products where workspace_id = p_workspace_id and status = 'active'");
    expect(migration).toContain("create or replace function public.archive_product(");
    expect(migration).toContain("update public.products set status = 'archived'");
    expect(migration).toContain("public.is_workspace_member(p_workspace_id)");
    expect(migration).toContain("where workspace_id = p_workspace_id and id = p_product_id returning * into v_product");
    expect(migration).not.toContain("delete from public.products");
  });

  it("keeps global analysis private and provenance relational", () => {
    expect(migration).toContain("revoke all on public.conversation_analysis from anon, authenticated");
    expect(migration).toContain("conversation_analysis_evidence");
    expect(migration).toContain("evidence_provenance");
    expect(migration).toContain("analyze-conversations");
    expect(migration).not.toContain("demand_gaps");
    expect(migration).not.toContain("demand_drifts");
  });

  it("restores server-role access without weakening tenant RLS", () => {
    for (const table of ["products", "product_snapshots", "demand_profiles", "product_matches", "match_rankings", "signals"]) {
      expect(privilegeCorrection).toContain(`public.${table}`);
    }
    expect(privilegeCorrection).toContain("to service_role");
    expect(privilegeCorrection).not.toContain("disable row level security");
    expect(privilegeCorrection).not.toContain("drop policy");
  });

  it("resolves pgcrypto digest explicitly without widening product table access", () => {
    expect(digestCorrection).toContain("create extension if not exists pgcrypto with schema extensions");
    expect(digestCorrection).toContain("extensions.digest(v_product.id::text, 'sha256'::text)");
    expect(digestCorrection).not.toContain("encode(digest(");
    expect(digestCorrection).toContain("security definer set search_path = public, auth");
    expect(digestCorrection).toContain("grant execute on function public.create_product(uuid, text, text, text) to authenticated, service_role");
    expect(digestCorrection).not.toContain("grant insert on public.products to authenticated");
    expect(digestCorrection).not.toContain("disable row level security");
  });
});
