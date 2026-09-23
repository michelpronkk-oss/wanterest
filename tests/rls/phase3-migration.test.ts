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

  it("makes signal dismissal server-authoritative and workspace-scoped, with no physical deletion", () => {
    expect(migration).toContain("lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'saved', 'dismissed', 'archived'))");
    expect(migration).toContain("create or replace function public.set_signal_lifecycle(");
    // Membership is checked before any mutation, and only a service role may bypass it.
    expect(migration).toContain("if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then");
    expect(migration).toContain("raise exception using errcode = '42501', message = 'workspace_access_denied';");
    // The update itself is scoped by workspace_id, so a signal from another
    // workspace can never be reached even if a caller passed its raw id.
    expect(migration).toContain("update public.signals set lifecycle_status = p_lifecycle_status\n   where workspace_id = p_workspace_id and id = p_signal_id returning * into v_signal;");
    expect(migration).toContain("if v_signal.id is null then raise exception using errcode = 'P0002', message = 'signal_not_found'; end if;");
    expect(migration).toContain("grant execute on function public.set_signal_lifecycle(uuid, uuid, text) to authenticated, service_role;");
    // No direct table-level update/delete grant exists for authenticated users;
    // the RPC above is the only sanctioned mutation path, and nothing deletes rows.
    expect(migration).not.toMatch(/grant\s+(update|delete|all)\s+on\s+public\.signals\s+to\s+authenticated/i);
    expect(migration).not.toContain("delete from public.signals");
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
