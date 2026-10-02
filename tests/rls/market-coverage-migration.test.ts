import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261111000000_market_coverage_model_v1.sql"), "utf8");

describe("Market Coverage V1 migration security and compatibility", () => {
  it("uses a separate tenant-free coverage identity without changing retrieval partitions", () => {
    expect(migration).toContain("create table public.market_coverage_scopes");
    expect(migration).toContain("create table public.market_coverage_partitions");
    expect(migration).toContain("partition_key text not null unique");
    expect(migration).toContain("unique nulls not distinct (scope_id, source_family, geography_code, language_code, surface_subtype)");
    const partitionDefinition = migration.match(/create table public\.market_coverage_partitions[\s\S]*?\n\);/)?.[0];
    expect(partitionDefinition).toBeDefined();
    expect(partitionDefinition).not.toMatch(/workspace_id|product_id/);
    expect(migration).not.toMatch(/alter table public\.market_partitions/i);
  });

  it("separates family and role and prevents owned/private data in global coverage", () => {
    expect(migration).toContain("source_family text not null");
    expect(migration).toContain("evidence_role text not null check (evidence_role in ('demand', 'supply', 'context'))");
    expect(migration).toContain("source_family not in ('owned_survey', 'owned_support', 'owned_crm', 'owned_form')");
    expect(migration).toContain("evidence_role text check (evidence_role is null or evidence_role in ('demand', 'supply', 'context'))");
    expect(migration).not.toContain("body text");
    expect(migration).not.toContain("payload jsonb");
    expect(migration).not.toContain("author_external_id");
  });

  it("links observation metadata to canonical evidence and product interest with composite workspace integrity", () => {
    expect(migration).toContain("foreign key (conversation_id, source_item_id)");
    expect(migration).toContain("references public.conversation_source_items(conversation_id, source_item_id) on delete restrict");
    expect(migration).toContain("foreign key (workspace_id, product_id)");
    expect(migration).toContain("references public.products(workspace_id, id) on delete cascade");
    expect(migration).toContain("coverage_partition_id uuid not null references public.market_coverage_partitions(id) on delete restrict");
  });

  it("enables RLS and denies all browser roles on every new table", () => {
    for (const table of ["market_coverage_scopes", "market_coverage_partitions", "market_coverage_requirements", "market_coverage_observations", "product_market_coverage_interests"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toMatch(/create policy .*market_coverage/i);
  });

  it("grants minimal service access and exposes only an invoker aggregate RPC", () => {
    expect(migration).toContain("grant select, insert on public.market_coverage_scopes, public.market_coverage_partitions to service_role");
    expect(migration).toContain("grant select, insert on public.market_coverage_observations to service_role");
    expect(migration).toContain("from service_role;");
    expect(migration).toContain("grant select, insert, update on public.market_coverage_requirements to service_role");
    expect(migration).toContain("grant select, insert, update, delete on public.product_market_coverage_interests to service_role");
    expect(migration).toContain("create or replace function public.market_coverage_summary_v1()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("and (p.geography_code is null or o.geography_code = p.geography_code)");
    expect(migration).toContain("and (p.surface_subtype is null or o.surface_subtype = p.surface_subtype)");
    expect(migration).toContain("revoke all on function public.market_coverage_summary_v1() from public, anon, authenticated, service_role");
    expect(migration).toContain("grant execute on function public.market_coverage_summary_v1() to service_role");
    expect(migration).toContain("case when a.metrics_allowed then a.independent_roots end");
  });

  it("keeps identity and observations append-only and performs no backfill or runtime activation", () => {
    expect(migration.match(/before update or delete on public\.market_coverage_(?:scopes|partitions|observations)/g)).toHaveLength(3);
    expect(migration).not.toMatch(/insert\s+into\s+public\.market_coverage_(?:scopes|partitions|requirements|observations)/i);
    expect(migration).not.toMatch(/update\s+public\.(?:source_items|conversations|product_matches|signals)/i);
    expect(migration).not.toMatch(/create\s+extension/i);
  });
});
