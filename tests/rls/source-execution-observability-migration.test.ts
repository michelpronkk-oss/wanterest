import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261105000000_source_execution_observability_v1.sql"), "utf8").toLowerCase();
const tables = [
  "source_query_executions",
  "source_query_execution_pages",
  "source_query_result_attributions",
  "product_query_result_outcomes",
];

describe("source execution observability migration security contract", () => {
  it("keeps every telemetry table behind RLS with explicit service-role access only", () => {
    for (const table of tables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toMatch(/revoke all on public\.source_query_executions,[\s\S]*?from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant select, insert, update on public\.source_query_executions,[\s\S]*?to service_role/);
    expect(migration).not.toMatch(/grant\s+[^;]*\b(delete|all)\b[^;]*\bto\s+service_role/i);
    expect(migration).not.toMatch(/grant\s+[^;]*\bto\s+(public|anon|authenticated)\b/i);
    expect(migration).not.toMatch(/create\s+policy\s+[^;]*\bon\s+public\.(source_query|product_query)/i);
    expect(migration).not.toContain("security definer");
  });

  it("persists only bounded IDs, aggregate counts and cursor-presence flags", () => {
    expect(migration).toContain("query_plan_fingerprint text not null check (query_plan_fingerprint ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain("cursor_requested boolean not null");
    expect(migration).toContain("continuation_available boolean not null");
    expect(migration).toContain("continuation_followed boolean not null");
    expect(migration).toContain("retry_after_ms integer check (retry_after_ms is null or retry_after_ms >= 0)");
    expect(migration).toContain("unique (execution_id, page_number)");
    expect(migration).toContain("unique (page_id, result_ordinal)");
    expect(migration).toContain("source_item_id uuid references public.source_items(id)");
    expect(migration).toContain("conversation_id uuid references public.conversations(id)");
    expect(migration).toContain("foreign key (workspace_id, product_id)");
    expect(migration).toContain("foreign key (workspace_id, product_match_evaluation_id)");
    expect(migration).toContain("foreign key (workspace_id, signal_id)");
    expect(migration).not.toMatch(/^\s*(query_text|normalized_query|cursor|cursor_value|author_id|author_name|body|title|payload_json)\s+/m);
    expect(migration).not.toContain("query_plan_id text");
  });

  it("retains idempotent page and product-outcome keys without delete privileges", () => {
    expect(migration).toContain("unique (execution_id, page_number)");
    expect(migration).toContain("unique (workspace_id, product_id, match_job_run_id, attempt_number, source_query_result_attribution_id)");
    expect(migration).toContain("on delete cascade");
    expect(migration).toContain("on delete set null (product_match_evaluation_id)");
    expect(migration).not.toMatch(/grant\s+[^;]*delete[^;]*on\s+public\.(source_query|product_query)/i);
  });
});
