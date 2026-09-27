import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261025000000_cross_product_routing_v1.sql", "utf8");

describe("cross-product routing migration contract", () => {
  it("creates only additive, versioned private route edges", () => {
    expect(migration).toMatch(/create table if not exists public\.product_routing_edges/i);
    expect(migration).toMatch(/routing_version text not null check \(routing_version = 'cross_product_routing_v1'\)/i);
    expect(migration).toMatch(/profile_version text not null check \(profile_version = 'product_routing_profile_v1'\)/i);
    expect(migration).toMatch(/foreign key \(workspace_id, product_id\) references public\.products\(workspace_id, id\)/i);
    expect(migration).toMatch(/references public\.conversations\(id\)/i);
    expect(migration).toMatch(/unique \(workspace_id, product_id, conversation_id, routing_version, profile_version, evidence_fingerprint, profile_fingerprint\)/i);
    expect(migration).toMatch(/route_status text not null check \(route_status in \('eligible', 'reused', 'capped', 'skipped'\)\)/i);
  });

  it("preserves tenant RLS and denies browser-wide access", () => {
    expect(migration).toMatch(/alter table public\.product_routing_edges enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.product_routing_edges from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select on public\.product_routing_edges to authenticated/i);
    expect(migration).toMatch(/grant select, insert, update, delete on public\.product_routing_edges to service_role/i);
    expect(migration).toMatch(/using \(public\.is_workspace_member\(workspace_id\)\)/i);
  });

  it("does not modify existing source, match, evaluation, qualification, or lifecycle tables", () => {
    expect(migration).not.toMatch(/alter table public\.(source_items|conversations|product_matches|product_match_evaluations|signals)\b/i);
    expect(migration).not.toMatch(/insert into public\.(source_items|conversations|product_matches|product_match_evaluations|signals)\b/i);
    expect(migration).not.toMatch(/drop table/i);
  });
});
