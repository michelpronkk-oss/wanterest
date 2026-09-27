import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SemanticShadowReasoningRepository, type ShadowReasoningKey } from "../../src/server/modules/intelligence/semantic-shadow-reasoning.repository";

const key: ShadowReasoningKey = { workspaceId: "workspace-a", productId: "product-a", conversationId: "conversation-a", fingerprint: "a".repeat(64), routerVersion: "semantic_reasoning_router_v1", reasoningVersion: "semantic_shadow_reasoning_v1", promptSchemaVersion: "prompt_v1" };

function client(rows: Record<string, unknown>[], conflict = false) {
  const filters: Array<[string, unknown]> = [];
  const inFilters: Array<[string, string[]]> = [];
  const nullFilters: string[] = [];
  type Query = {
    select: () => Query;
    eq: (field: string, value: unknown) => Query;
    in: (field: string, values: string[]) => Query;
    is: (field: string, value: null) => Query;
    update: (row: Record<string, unknown>) => Query;
    order: () => Promise<{ data: Record<string, unknown>[]; error: null }>;
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
    insert: () => { select: () => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { code: string } | null }> } };
  };
  const query: Query = {
    select: () => query, eq: (field: string, value: unknown) => (filters.push([field, value]), query), in: (field: string, values: string[]) => (inFilters.push([field, values]), query), is: (field: string) => (nullFilters.push(field), query), update: () => query,
    order: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(conflict ? { data: null, error: { code: "23505" } } : { data: rows[0] ?? { id: "new" }, error: null }) }) }),
  };
  return { from: vi.fn(() => query), rpc: vi.fn(async () => ({ data: true, error: null })), filters, inFilters, nullFilters };
}

function appendOnlyClient() {
  const rows: Record<string, unknown>[] = [];
  const matches = (row: Record<string, unknown>, filters: Array<[string, unknown]>, inFilters: Array<[string, string[]]>) => filters.every(([field, value]) => row[field] === value) && inFilters.every(([field, values]) => values.includes(String(row[field])));
  type AppendOnlyQuery = {
    select: () => AppendOnlyQuery;
    eq: (field: string, value: unknown) => AppendOnlyQuery;
    in: (field: string, values: string[]) => AppendOnlyQuery;
    is: (field: string, value: null) => AppendOnlyQuery;
    update: (input: Record<string, unknown>) => AppendOnlyQuery;
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
    order: () => Promise<{ data: Record<string, unknown>[]; error: null }>;
    insert: (input: Record<string, unknown>) => { select: () => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { code: string } | null }> } };
  };
  const db = {
    rows,
    from: vi.fn(() => {
      const filters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, string[]]> = [];
      const query: AppendOnlyQuery = {
        select: () => query,
        eq: (field: string, value: unknown) => (filters.push([field, value]), query),
        in: (field: string, values: string[]) => (inFilters.push([field, values]), query),
        is: () => query,
        update: () => query,
        maybeSingle: async () => ({ data: rows.find((row) => matches(row, filters, inFilters)) ?? null, error: null }),
        order: async () => ({ data: rows.filter((row) => matches(row, filters, inFilters)).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))), error: null }),
        insert: (input: Record<string, unknown>) => ({ select: () => ({ maybeSingle: async () => {
          const reusable = input.execution_status === "success" || input.execution_status === "cache_hit";
          const conflict = reusable && rows.some((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.conversation_id === input.conversation_id && row.fingerprint === input.fingerprint && (row.execution_status === "success" || row.execution_status === "cache_hit"));
          if (conflict) return { data: null, error: { code: "23505" } };
          const row = { ...input, id: `attempt-${rows.length + 1}`, created_at: `2026-01-01T00:00:0${rows.length}.000Z` };
          rows.push(row);
          return { data: row, error: null };
        } }) }),
      };
      return query;
    }),
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  return db;
}

describe("SemanticShadowReasoningRepository", () => {
  it("finds only a successful cache entry scoped by workspace, product, conversation, fingerprint, and versions", async () => {
    const db = client([{ id: "cached" }]);
    await expect(new SemanticShadowReasoningRepository(db).findByFingerprint(key)).resolves.toEqual({ id: "cached" });
    expect(db.filters).toEqual(expect.arrayContaining([["workspace_id", "workspace-a"], ["product_id", "product-a"], ["conversation_id", "conversation-a"], ["fingerprint", key.fingerprint], ["router_version", key.routerVersion], ["reasoning_version", key.reasoningVersion], ["prompt_schema_version", key.promptSchemaVersion]]));
    expect(db.inFilters).toContainEqual(["execution_status", ["success", "cache_hit"]]);
  });

  it("inserts once and resolves a uniqueness race by loading the existing immutable row", async () => {
    const db = client([{ id: "existing" }], true);
    await expect(new SemanticShadowReasoningRepository(db).insertImmutable({ ...key, execution_status: "success" })).resolves.toEqual({ id: "existing" });
  });

  it("keeps replay reads workspace/product/conversation scoped", async () => {
    const db = client([{ id: "older", created_at: "2026-01-01T00:00:00.000Z" }, { id: "newer", created_at: "2026-02-01T00:00:00.000Z" }]);
    await expect(new SemanticShadowReasoningRepository(db).loadForReplay(key)).resolves.toEqual([{ id: "newer", created_at: "2026-02-01T00:00:00.000Z" }, { id: "older", created_at: "2026-01-01T00:00:00.000Z" }]);
    expect(db.filters).toEqual(expect.arrayContaining([["workspace_id", "workspace-a"], ["product_id", "product-a"], ["conversation_id", "conversation-a"]]));
    expect(db.inFilters).toContainEqual(["execution_status", ["success", "cache_hit"]]);
  });

  it("uses the database claim guard before and after an execution attempt", async () => {
    const db = client([]);
    const repository = new SemanticShadowReasoningRepository(db);
    await expect(repository.claimAttempt({ ...key, leaseToken: "00000000-0000-4000-8000-000000000001" })).resolves.toBe(true);
    await expect(repository.releaseAttempt({ ...key, leaseToken: "00000000-0000-4000-8000-000000000001" })).resolves.toBeUndefined();
    expect(db.rpc).toHaveBeenNthCalledWith(1, "claim_semantic_shadow_reasoning", expect.objectContaining({ p_fingerprint: key.fingerprint, p_lease_seconds: 120 }));
    expect(db.rpc).toHaveBeenNthCalledWith(2, "release_semantic_shadow_reasoning", expect.objectContaining({ p_fingerprint: key.fingerprint }));
  });

  it("keeps production-derived failed attempts immutable while allowing a later reusable retry", async () => {
    const db = appendOnlyClient();
    const repository = new SemanticShadowReasoningRepository(db);
    const productionKeys = [
      { conversationId: "a1b92346-e5bd-5906-a914-c9578237fe3f", fingerprint: "8".repeat(64) },
      { conversationId: "c69185b0-0bcf-5994-bd06-203a05208dc8", fingerprint: "9".repeat(64) },
    ];
    for (const productionKey of productionKeys) {
      const retryKey = { ...key, workspaceId: "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a", productId: "c5946172-6bef-45c0-a5da-08aedc9294cd", ...productionKey };
      await repository.insertImmutable({ ...retryKey, execution_status: "schema_failed", error_code: "SCHEMA_INVALID" });
      await repository.insertImmutable({ ...retryKey, execution_status: "provider_failed", error_code: "PROVIDER_FAILED" });
      await expect(repository.loadForReplay(retryKey)).resolves.toEqual([]);
      const success = await repository.insertImmutable({ ...retryKey, execution_status: "success", merged_shadow_reasoning: { version: "conversation_market_reasoning_v2" } });
      await expect(repository.loadForReplay(retryKey)).resolves.toEqual([expect.objectContaining({ id: success.id, execution_status: "success" })]);
      await expect(repository.insertImmutable({ ...retryKey, execution_status: "success" })).resolves.toEqual(success);
    }
    expect(db.rows).toHaveLength(6);
    expect(db.rows.filter((row) => row.execution_status === "schema_failed")).toHaveLength(2);
    expect(db.rows.filter((row) => row.execution_status === "provider_failed")).toHaveLength(2);
  });

  it("attaches a comparison once without overwriting an existing immutable semantic artifact", async () => {
    const db = client([{ id: "compared" }]);
    await expect(new SemanticShadowReasoningRepository(db).persistComparison({ ...key, actualStatus: "weak_candidate", actualReasonCodes: ["LOW_RELEVANCE"], shadowStatus: "qualified", shadowReasonCodes: ["STRONG_EVIDENCE"], impact: ["would_become_qualified"] })).resolves.toEqual({ id: "compared" });
    expect(db.nullFilters).toContain("actual_qualification_status");
    expect(db.filters).toEqual(expect.arrayContaining([["execution_status", "success"]]));
  });
});
