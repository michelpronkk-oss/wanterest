import { describe, expect, it } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { GitHubSourceAdapter } from "../../src/server/providers/source/github";

const live = process.env.RUN_GITHUB_SMOKE === "1" ? it : it.skip;

describe("GitHub live smoke", () => {
  live("runs bounded public issue discovery through raw, normalization, and canonicalization", async () => {
    const query = process.env.GITHUB_SMOKE_QUERY?.trim() || "integration";
    const limit = 5;
    const repository = new InMemoryIngestionRepository();
    const adapter = new GitHubSourceAdapter();
    const service = new IngestionService(repository, new Map([["github", adapter]]));
    const discovery = await service.discoverSource("github", { query, limit, expandThreads: false, requestMetadata: {} });
    const replay = await service.replay({ sourceKey: "github", normalizationVersion: "github-v1", canonicalizationVersion: "canonical-v1", limit: 20 });
    const health = await service.healthCheck("github");
    const firstRaw = [...repository.rawItems.values()][0];
    const authenticated = Boolean(firstRaw?.request_metadata && typeof firstRaw.request_metadata === "object" && !Array.isArray(firstRaw.request_metadata) && firstRaw.request_metadata.authenticated);

    console.info(JSON.stringify({
      query,
      authMode: authenticated ? "authenticated" : "public",
      rawItems: repository.rawItems.size,
      normalizedItems: repository.sourceItems.size,
      conversations: repository.conversations.size,
      nextCursorPresent: Boolean(discovery.nextCursor),
      diagnostics: discovery.diagnostics,
      rateRemaining: health.rateLimit?.remaining ?? null,
      replay,
      sourceHealth: { ok: health.ok, latencyMs: health.latencyMs, degradationState: health.degradationState },
    }, null, 2));
    expect(discovery.rawInserted).toBeLessThanOrEqual(limit);
    expect(replay.failed).toBe(0);
    expect(health.sourceKey).toBe("github");
    expect(health.ok).toBe(true);
  }, 30_000);
});
