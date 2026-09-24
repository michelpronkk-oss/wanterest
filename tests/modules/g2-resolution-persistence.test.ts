import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistG2Resolutions, type SourceExecutionResult } from "../../src/server/modules/onboarding/initial-scan.service";
import { g2ProductMappingSchema, type G2ProductMapping } from "../../src/server/providers/source/g2/product-resolution";

const NATURAL_KEY = "workspace_id,product_id,source_key,strategy_version";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

type StrategyRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  source_key: string;
  strategy_version: number;
  filters: Record<string, unknown>;
  is_active: boolean;
};

type UpsertPayload = Omit<StrategyRow, "id">;

class DiscoveryStrategiesClient {
  readonly rows: StrategyRow[] = [];
  readonly upserts: Array<{ payload: UpsertPayload; options: { onConflict?: string } }> = [];
  private pendingPayload: UpsertPayload | null = null;
  private pendingOptions: { onConflict?: string } = {};
  private readonly predicates: Array<[string, unknown]> = [];

  from(table: string): this {
    expect(table).toBe("discovery_strategies");
    return this;
  }

  select(columns: string): this {
    void columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push([column, value]);
    return this;
  }

  maybeSingle(): Promise<{ data: StrategyRow | null; error: null }> {
    const row = this.rows.find((candidate) => this.predicates.every(([column, value]) => candidate[column as keyof StrategyRow] === value)) ?? null;
    this.predicates.length = 0;
    return Promise.resolve({ data: row, error: null });
  }

  upsert(payload: UpsertPayload, options: { onConflict?: string }): this {
    this.pendingPayload = payload;
    this.pendingOptions = options;
    this.upserts.push({ payload, options });
    return this;
  }

  single(): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
    if (!this.pendingPayload) return Promise.resolve({ data: null, error: { message: "missing upsert payload" } });
    if (this.pendingOptions.onConflict !== NATURAL_KEY) return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint" } });
    const existingIndex = this.rows.findIndex((candidate) => candidate.workspace_id === this.pendingPayload?.workspace_id
      && candidate.product_id === this.pendingPayload?.product_id
      && candidate.source_key === this.pendingPayload?.source_key
      && candidate.strategy_version === this.pendingPayload?.strategy_version);
    const id = existingIndex >= 0 ? this.rows[existingIndex]!.id : `strategy-${this.rows.length + 1}`;
    const row = { id, ...this.pendingPayload };
    if (existingIndex >= 0) this.rows[existingIndex] = row;
    else this.rows.push(row);
    this.pendingPayload = null;
    this.pendingOptions = {};
    return Promise.resolve({ data: { id }, error: null });
  }
}

function mapping(targetKey: string, status: G2ProductMapping["status"], candidateProductIds: string[], productIdValue?: string): NonNullable<SourceExecutionResult["resolutions"]>[number] {
  return {
    status,
    targetKey,
    targetFingerprint: `${targetKey}|fingerprint`,
    ...(productIdValue ? { productId: productIdValue, matchedBy: "domain" as const } : {}),
    candidateProductIds,
    resolvedAt: "2026-09-25T12:00:00.000Z",
    resolverVersion: "g2-product-resolution-v1",
  };
}

function clientForPersistence(client: DiscoveryStrategiesClient): Parameters<typeof persistG2Resolutions>[0] {
  return client as unknown as Parameters<typeof persistG2Resolutions>[0];
}

describe("G2 resolution metadata persistence", () => {
  it("replaces the same natural-key row and preserves mappings and filters", async () => {
    const client = new DiscoveryStrategiesClient();
    const context = { workspaceId, productId };

    await persistG2Resolutions(clientForPersistence(client), context, [mapping("product", "no_match", [])]);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]?.id).toBe("strategy-1");
    expect(client.rows[0]?.filters).toMatchObject({ g2ProductMappings: { product: { status: "no_match", candidateProductIds: [] } } });
    expect(g2ProductMappingSchema.parse((client.rows[0]?.filters.g2ProductMappings as Record<string, unknown>).product)).toMatchObject({ status: "no_match", candidateProductIds: [] });
    client.rows[0]!.filters = { ...client.rows[0]!.filters, preservedFilter: "keep-me" };

    await persistG2Resolutions(clientForPersistence(client), context, [mapping("product", "resolved", ["g2-linear"], "g2-linear")]);
    expect(client.rows).toHaveLength(1);
    expect(client.upserts.every(({ options }) => options.onConflict === NATURAL_KEY)).toBe(true);
    expect(client.rows[0]?.filters).toMatchObject({ preservedFilter: "keep-me", g2ProductMappings: { product: { status: "resolved", productId: "g2-linear", candidateProductIds: ["g2-linear"] } } });
    expect(g2ProductMappingSchema.parse((client.rows[0]?.filters.g2ProductMappings as Record<string, unknown>).product)).toMatchObject({ status: "resolved", productId: "g2-linear" });
  });

  it("keeps separate strategy rows isolated by workspace and product", async () => {
    const client = new DiscoveryStrategiesClient();
    await persistG2Resolutions(clientForPersistence(client), { workspaceId, productId }, [mapping("product", "no_match", [])]);
    await persistG2Resolutions(clientForPersistence(client), { workspaceId: "33333333-3333-4333-8333-333333333333", productId }, [mapping("product", "no_match", [])]);
    await persistG2Resolutions(clientForPersistence(client), { workspaceId, productId: "44444444-4444-4444-8444-444444444444" }, [mapping("product", "no_match", [])]);

    expect(client.rows).toHaveLength(3);
    expect(new Set(client.rows.map((row) => `${row.workspace_id}:${row.product_id}`)).size).toBe(3);
  });
});
