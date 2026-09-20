import { describe, expect, it } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { RedditSourceAdapter } from "../../src/server/providers/source/reddit";

const configured = process.env.RUN_REDDIT_SMOKE === "1" && [
  process.env.REDDIT_CLIENT_ID,
  process.env.REDDIT_CLIENT_SECRET,
  process.env.REDDIT_USER_AGENT,
].every((value) => Boolean(value?.trim()));

describe("Reddit live smoke", () => {
  it.skipIf(!configured)("runs a bounded authenticated read and replay", async () => {
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["reddit", new RedditSourceAdapter()]]));
    const discovery = await service.discoverSource("reddit", { query: "test", limit: 5, requestMetadata: {} });
    const replay = await service.replay({ sourceKey: "reddit", normalizationVersion: "reddit-v1", canonicalizationVersion: "canonical-v1" });
    const health = await service.healthCheck("reddit");
    const commentsIngested = [...repository.sourceItems.values()].filter((row) => row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) && row.metadata.itemType === "comment").length;
    expect(discovery.rawInserted).toBeGreaterThanOrEqual(0);
    expect(replay.failed).toBe(0);
    expect(health.ok).toBe(true);
    console.info(JSON.stringify({
      query: "test",
      scope: "global",
      rawItems: discovery.rawInserted,
      normalizedItems: replay.normalized,
      conversations: repository.conversations.size,
      commentsIngested,
      nextCursorPresent: Boolean(discovery.nextCursor),
      sourceHealth: health.degradationState,
    }));
  });
});
