import { describe, expect, it, vi } from "vitest";

import { buildProductRoutingProfile } from "../../src/server/modules/operations/cross-product-routing.service";
import { runCrossProductRoutingShadow } from "../../src/server/modules/operations/cross-product-routing-shadow.service";

const profile = (id: string) => buildProductRoutingProfile({ workspaceId: "10000000-0000-4000-8000-000000000001", productId: id, productName: id.endsWith("1") ? "Linear" : "ClickUp", categories: ["project management"], jobs: ["manage engineering projects"], competitors: ["Jira"] });

describe("cross-product routing shadow", () => {
  it("reuses one public conversation across bounded private product routes", async () => {
    const persist = vi.fn(async () => "created" as const);
    const result = await runCrossProductRoutingShadow({
      evidence: [{ conversationId: "20000000-0000-4000-8000-000000000001", contentHash: "a", title: "Project management alternatives", body: "Our team needs a lighter project management tool.", sourceKey: "fixture", publishedAt: "2026-01-01T00:00:00Z" }],
      profiles: [profile("30000000-0000-4000-8000-000000000001"), profile("30000000-0000-4000-8000-000000000002")],
      existingProductIdsByConversation: new Map([["20000000-0000-4000-8000-000000000001", new Set<string>()]]),
      persist,
    });
    expect(result.routes).toHaveLength(2);
    expect(new Set(result.routes.map((route) => route.conversationId))).toEqual(new Set(["20000000-0000-4000-8000-000000000001"]));
    expect(new Set(result.routes.map((route) => route.productId)).size).toBe(2);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(result.telemetry.semanticCalls).toBe(0);
  });
});
