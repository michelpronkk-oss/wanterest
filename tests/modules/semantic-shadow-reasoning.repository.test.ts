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
  return { from: vi.fn(() => query), filters, inFilters, nullFilters };
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
    const db = client([{ id: "newer" }, { id: "older" }]);
    await expect(new SemanticShadowReasoningRepository(db).loadForReplay(key)).resolves.toEqual([{ id: "newer" }, { id: "older" }]);
    expect(db.filters).toEqual(expect.arrayContaining([["workspace_id", "workspace-a"], ["product_id", "product-a"], ["conversation_id", "conversation-a"]]));
  });

  it("attaches a comparison once without overwriting an existing immutable semantic artifact", async () => {
    const db = client([{ id: "compared" }]);
    await expect(new SemanticShadowReasoningRepository(db).persistComparison({ ...key, actualStatus: "weak_candidate", actualReasonCodes: ["LOW_RELEVANCE"], shadowStatus: "qualified", shadowReasonCodes: ["STRONG_EVIDENCE"], impact: ["would_become_qualified"] })).resolves.toEqual({ id: "compared" });
    expect(db.nullFilters).toContain("actual_qualification_status");
    expect(db.filters).toEqual(expect.arrayContaining([["execution_status", "success"]]));
  });
});
