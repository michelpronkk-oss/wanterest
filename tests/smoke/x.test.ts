import { describe, expect, it } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { SourceAdapterError } from "../../src/server/providers/source/contracts";
import { XSourceAdapter } from "../../src/server/providers/source/x";
import { getXRuntimeConfig } from "../../src/server/providers/source/x/x.auth";
import { estimateXReadCost } from "../../src/server/providers/source/x/x.cost";

const live = process.env.RUN_X_SMOKE === "1" ? it : it.skip;

describe("X live smoke", () => {
  live("runs one bounded recent-search page through raw, normalization, and canonicalization", async () => {
    const runtime = getXRuntimeConfig();
    const query = process.env.X_SMOKE_QUERY?.trim() || "integration";
    const maxPosts = Math.min(10, runtime.maxPostsPerScan);
    console.info(JSON.stringify({
      query,
      authMode: "authenticated_app_only",
      maxRequestedPosts: maxPosts,
      maxPages: 1,
      estimatedMaximumReadCostUsd: estimateXReadCost(10, runtime.postReadCostUsd),
      costConfigVersion: runtime.costConfigVersion,
      token: "[redacted]",
    }, null, 2));

    const repository = new InMemoryIngestionRepository();
    const adapter = new XSourceAdapter();
    const service = new IngestionService(repository, new Map([["x", adapter]]));
    let discovery;
    try {
      discovery = await service.discoverSource("x", {
        query,
        limit: maxPosts,
        requestMetadata: { maxResults: maxPosts, maxPages: 1, maxBillablePostsPerDiscovery: maxPosts },
      });
    } catch (error) {
      if (error instanceof SourceAdapterError && error.code === "INSUFFICIENT_CREDITS") {
        console.info("X live smoke unavailable: insufficient API credits.");
        return;
      }
      throw error;
    }
    const replay = await service.replay({ sourceKey: "x", normalizationVersion: "x-v1", canonicalizationVersion: "canonical-v1", limit: 20 });
    const health = await service.healthCheck("x");
    const firstRaw = [...repository.rawItems.values()][0];
    const metadata = firstRaw?.request_metadata && typeof firstRaw.request_metadata === "object" && !Array.isArray(firstRaw.request_metadata) ? firstRaw.request_metadata : {};
    const billablePosts = typeof metadata.providerResultCount === "number" ? metadata.providerResultCount : repository.rawItems.size;
    console.info(JSON.stringify({
      rawItems: repository.rawItems.size,
      normalizedItems: repository.sourceItems.size,
      conversations: repository.conversations.size,
      nextCursorPresent: Boolean(discovery.nextCursor),
      billablePosts,
      estimatedActualReadCostUsd: estimateXReadCost(billablePosts, runtime.postReadCostUsd),
      diagnostics: discovery.diagnostics,
      rateRemaining: health.rateLimit?.remaining ?? null,
      rateLimit: health.rateLimit ?? null,
      replay,
      sourceHealth: { ok: health.ok, latencyMs: health.latencyMs, degradationState: health.degradationState },
    }, null, 2));
    expect(discovery.rawInserted).toBeLessThanOrEqual(10);
    expect(discovery.nextCursor).toBeUndefined();
    expect(replay.failed).toBe(0);
    expect(health.sourceKey).toBe("x");
    expect(health.ok).toBe(true);
  }, 30_000);
});

