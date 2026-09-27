import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261024000000_semantic_shadow_retry_constraint_repair_v1.sql"),
  "utf8",
).replace(/--[^\r\n]*/g, "");

const intendedLegacyConstraintName = "semantic_shadow_reasoning_workspace_id_product_id_conversation_id_fingerprint_key";
const actualCatalogConstraintName = "semantic_shadow_reasoning_workspace_id_product_id_conversat_key";

type Attempt = {
  status: "schema_failed" | "provider_failed" | "success" | "cache_hit";
  fingerprint: string;
  immutablePayload: string;
};

function appendAttempt(rows: Attempt[], attempt: Attempt): Attempt {
  const reusable = attempt.status === "success" || attempt.status === "cache_hit";
  if (reusable && rows.some((row) => row.fingerprint === attempt.fingerprint && (row.status === "success" || row.status === "cache_hit"))) {
    throw new Error("duplicate_reusable_semantic_shadow_artifact");
  }
  rows.push(attempt);
  return attempt;
}

describe("semantic shadow truncated-constraint repair migration", () => {
  it("resolves the actual legacy unique constraint from PostgreSQL catalogs", () => {
    expect(intendedLegacyConstraintName.length).toBeGreaterThan(63);
    expect(actualCatalogConstraintName.length).toBe(63);
    expect(actualCatalogConstraintName).not.toBe(intendedLegacyConstraintName);
    expect(migration).toContain("from pg_constraint c");
    expect(migration).toContain("join pg_index i on i.indexrelid = c.conindid");
    expect(migration).toContain("c.contype = 'u'");
    expect(migration).toContain("i.indpred is null");
    expect(migration).toContain("c.conkey = array[");
    expect(migration).toContain("alter table public.semantic_shadow_reasoning drop constraint");
    expect(migration).not.toContain("drop constraint if exists semantic_shadow_reasoning_workspace_id_product_id_conversation_id_fingerprint_key");
  });

  it("does not remove the reusable index or claim/lease objects", () => {
    expect(migration).toContain("semantic_shadow_reasoning_reusable_fingerprint_key");
    expect(migration).not.toMatch(/drop\s+index[\s\S]*semantic_shadow_reasoning_reusable_fingerprint_key/i);
    expect(migration).not.toMatch(/drop\s+table[\s\S]*semantic_shadow_reasoning_claims/i);
    expect(migration).not.toMatch(/drop\s+function[\s\S]*semantic_shadow_reasoning/i);
    expect(migration).not.toMatch(/disable\s+row level security|force\s+row level security/i);
  });

  it("models append-only failed retries plus one reusable success", () => {
    const fingerprint = "a".repeat(64);
    const rows: Attempt[] = [];
    const failedOne = appendAttempt(rows, { status: "schema_failed", fingerprint, immutablePayload: "failed-one" });
    const failedTwo = appendAttempt(rows, { status: "schema_failed", fingerprint, immutablePayload: "failed-two" });
    const success = appendAttempt(rows, { status: "success", fingerprint, immutablePayload: "success" });

    expect(rows).toEqual([failedOne, failedTwo, success]);
    expect(rows.filter((row) => row.status === "schema_failed")).toHaveLength(2);
    expect(rows.filter((row) => row.status === "success")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "success" || row.status === "cache_hit")).toEqual([success]);
    expect(() => appendAttempt(rows, { status: "success", fingerprint, immutablePayload: "duplicate" })).toThrow("duplicate_reusable_semantic_shadow_artifact");
    expect(rows.filter((row) => row.status === "schema_failed").map((row) => row.immutablePayload)).toEqual(["failed-one", "failed-two"]);
  });
});
