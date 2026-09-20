import { describe, expect, it } from "vitest";

import { BlueskySourceAdapter } from "../../src/server/providers/source/bluesky";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";

const live = process.env.RUN_BLUESKY_SMOKE === "1" ? it : it.skip;

describe("Bluesky live smoke", () => {
  live("runs a bounded public discovery through raw, normalization, and canonicalization", async () => {
    const query = "looking for crm automation";
    const limit = 10;
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["bluesky", new BlueskySourceAdapter()]]));
    const discovery = await service.discoverSource("bluesky", { query, limit });
    const replay = await service.replay({ sourceKey: "bluesky", normalizationVersion: "bluesky-v1", canonicalizationVersion: "canonical-v1", limit: 20 });
    const health = await service.healthCheck("bluesky");

    console.info(JSON.stringify({
      query,
      rawItems: repository.rawItems.size,
      normalizedItems: repository.sourceItems.size,
      conversations: repository.conversations.size,
      nextCursorPresent: Boolean(discovery.nextCursor),
      replay,
      health: { ok: health.ok, latencyMs: health.latencyMs, degradationState: health.degradationState },
    }, null, 2));
    expect(repository.rawItems.size).toBeLessThanOrEqual(20);
    expect(health.sourceKey).toBe("bluesky");
    expect(health.ok).toBe(true);
  }, 30_000);
});
