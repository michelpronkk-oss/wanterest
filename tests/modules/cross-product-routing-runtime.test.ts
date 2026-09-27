import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listProducts = vi.hoisted(() => vi.fn());
const upsertEdge = vi.hoisted(() => vi.fn());

vi.mock("@/server/modules/products/product.repository", () => ({ listProducts }));
vi.mock("@/server/modules/operations/cross-product-routing.repository", () => ({
  CrossProductRoutingRepository: class {
    upsertEdge(route: unknown) {
      return upsertEdge(route);
    }
  },
}));

const { runCrossProductRoutingShadowForNormalScan, runCrossProductRoutingShadowForRefresh } = await import("../../src/server/modules/operations/cross-product-routing-runtime.service");

const WORKSPACE = "10000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE = "10000000-0000-4000-8000-000000000002";
const PRODUCT = "30000000-0000-4000-8000-000000000001";
const OTHER_PRODUCT = "30000000-0000-4000-8000-000000000002";
const SOURCE = "50000000-0000-4000-8000-000000000001";

function product(id: string, workspaceId = WORKSPACE, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: workspaceId,
    name: id === PRODUCT ? "Linear" : "ClickUp",
    slug: id,
    website_url: null,
    status: "active",
    current_snapshot_id: null,
    current_demand_profile_id: `profile-${id}`,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function conversation(id: string, body = "Linear project management alternatives") {
  return { id, content_hash: `hash-${id}`, title: "Tool discussion", body, published_at: "2026-09-01T00:00:00Z", primary_source_item_id: SOURCE };
}

function fakeClient(conversations: Array<Record<string, unknown>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    conversations,
    source_items: [{ id: SOURCE, source_key: "fixture" }],
    demand_profiles: [
      { id: `profile-${PRODUCT}`, workspace_id: WORKSPACE, product_id: PRODUCT, include_terms: ["Linear"], problems: { value: "project management" }, desired_outcomes: { value: "less overhead" }, jobs: { value: "manage projects" }, capabilities: { value: "project management" }, alternatives: ["Jira"] },
      { id: `profile-${OTHER_PRODUCT}`, workspace_id: WORKSPACE, product_id: OTHER_PRODUCT, include_terms: ["ClickUp"], problems: { value: "project management" }, desired_outcomes: { value: "less overhead" }, jobs: { value: "manage projects" }, capabilities: { value: "project management" }, alternatives: ["Jira"] },
    ],
  };
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          rows = rows.filter((row) => row[field] === value);
          return query;
        },
        in: (field: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[field]));
          return query;
        },
        order: () => query,
        limit: async () => ({ data: rows, error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return query;
    },
  };
}

describe("cross-product routing runtime orchestration", () => {
  beforeEach(() => {
    listProducts.mockReset();
    upsertEdge.mockReset();
    upsertEdge.mockImplementation(async (route: { status: string }) => ({ wasExisting: route.status === "reused" }));
    listProducts.mockResolvedValue([product(PRODUCT), product(OTHER_PRODUCT), product("archived", WORKSPACE, { status: "archived" })]);
  });

  it("fails closed before loading products when shadow mode is off or the workspace is not allowlisted", async () => {
    const client = fakeClient([conversation("20000000-0000-4000-8000-000000000001")]);
    for (const env of [
      { CROSS_PRODUCT_ROUTING_MODE: "off", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: WORKSPACE },
      { CROSS_PRODUCT_ROUTING_MODE: "shadow", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: OTHER_WORKSPACE },
    ]) {
      await expect(runCrossProductRoutingShadowForNormalScan({ client, product: product(PRODUCT), conversationIds: ["20000000-0000-4000-8000-000000000001"], env })).resolves.toBeNull();
    }
    expect(listProducts).not.toHaveBeenCalled();
    expect(upsertEdge).not.toHaveBeenCalled();
  });

  it("runs one bounded normal-scan shadow pass with current-product comparison context and no semantic calls", async () => {
    const client = fakeClient([conversation("20000000-0000-4000-8000-000000000001")]);
    const env = { CROSS_PRODUCT_ROUTING_MODE: "shadow", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: WORKSPACE };
    const telemetry = await runCrossProductRoutingShadowForNormalScan({ client, product: product(PRODUCT), conversationIds: ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"], env });

    expect(upsertEdge.mock.calls.map(([route]) => ({ productId: (route as { productId: string }).productId, status: (route as { status: string }).status }))).toEqual([
      { productId: PRODUCT, status: "reused" },
      { productId: OTHER_PRODUCT, status: "eligible" },
    ]);
    expect(telemetry).toMatchObject({
      shadowInvoked: true,
      evidenceSeen: 1,
      conversationsExamined: 1,
      routingProfilesConsidered: 2,
      candidateProductsBeforeCap: 2,
      candidateProductsAfterCap: 2,
      routesCreated: 1,
      routesReused: 1,
      routeMissShadow: 0,
      routeExtraShadow: 1,
      semanticCalls: 0,
      conversationCapSkips: 0,
    });
    expect(upsertEdge).toHaveBeenCalledTimes(2);
  });

  it("selects a deterministic first 50 conversations and reports the evidence cap", async () => {
    const ids = Array.from({ length: 55 }, (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    const client = fakeClient(ids.map((id) => conversation(id)));
    const env = { CROSS_PRODUCT_ROUTING_MODE: "shadow", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: WORKSPACE };
    const telemetry = await runCrossProductRoutingShadowForNormalScan({ client, product: product(PRODUCT), conversationIds: [...ids].reverse(), env });

    expect(telemetry).toMatchObject({ evidenceSeen: 50, conversationsExamined: 50, conversationCapSkips: 5 });
    expect(upsertEdge).toHaveBeenCalledTimes(100);
    const routedConversationIds = upsertEdge.mock.calls.map(([route]) => (route as { conversationId: string }).conversationId);
    expect(new Set(routedConversationIds)).toEqual(new Set(ids.slice(0, 50)));
  });

  it("uses the same orchestration and preserves route reuse for incremental input", async () => {
    const client = fakeClient([conversation("20000000-0000-4000-8000-000000000001")]);
    const env = { CROSS_PRODUCT_ROUTING_MODE: "shadow", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: WORKSPACE };
    await runCrossProductRoutingShadowForNormalScan({ client, product: product(PRODUCT), conversationIds: ["20000000-0000-4000-8000-000000000001"], env });
    upsertEdge.mockResolvedValue({ wasExisting: true });
    const telemetry = await runCrossProductRoutingShadowForRefresh({ client, workspaceIds: [WORKSPACE], products: [product(PRODUCT), product(OTHER_PRODUCT)], conversationIds: ["20000000-0000-4000-8000-000000000001"], env });

    expect(telemetry).toMatchObject({ shadowInvoked: true, routesCreated: 0, routesReused: 2, semanticCalls: 0 });
    expect(upsertEdge).toHaveBeenCalledTimes(4);
  });
});
