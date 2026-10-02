import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261110000000_signal_pagination_depth_v1.sql", "utf8");

describe("Signal Pagination / Depth V1 forward migration", () => {
  it("adds only closed count-free decision metadata to the existing private page table", () => {
    expect(migration).toContain("alter table public.source_query_execution_pages");
    expect(migration).toContain("pagination_policy_version text");
    expect(migration).toContain("continuation_eligible boolean");
    expect(migration).toContain("continuation_reason text");
    expect(migration).toContain("continuation_attempted boolean not null default false");
    expect(migration).toContain("continuation_status text");
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/public\.(?:conversations|signals|product_matches|evaluations)\s+(?:set|where|delete|update)/i);
  });

  it("constrains policy, reasons, statuses, and first-page decision scope", () => {
    for (const reason of ["eligible_high_novelty", "no_new_raw_evidence", "repetitive_roots", "scan_continuation_budget_exhausted"]) {
      expect(migration).toContain(`'${reason}'`);
    }
    for (const status of ["not_attempted", "received", "empty", "repetitive", "failed"]) expect(migration).toContain(`'${status}'`);
    expect(migration).toContain("source_query_execution_pages_continuation_attempt_check");
    expect(migration).toContain("source_query_execution_pages_continuation_eligibility_check");
    expect(migration).toContain("source_query_execution_pages_pagination_scope_check");
    expect(migration).toContain("continuation_attempted = continuation_eligible");
    expect(migration).toContain("page_number = 2 and continuation_eligible is null");
  });

  it("leaves existing RLS and grants untouched and is transaction-wrapped", () => {
    expect(migration.trimStart().toLowerCase().startsWith("--")).toBe(true);
    expect(migration).toMatch(/begin\s*;/i);
    expect(migration).toMatch(/commit\s*;\s*$/i);
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(/grant\s|revoke\s/i);
    expect(migration).not.toMatch(/security\s+definer|create\s+(?:or\s+replace\s+)?function/i);
  });
});
