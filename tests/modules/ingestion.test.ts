import { describe, expect, it } from "vitest";

import { jsonValueSchema } from "../../src/server/db/database.helpers";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { sha256Json, stableJsonStringify } from "../../src/server/modules/ingestion/hash";
import { SourceAdapterError, type SourceAdapter } from "../../src/server/providers/source/contracts";
import { fixtureSourceAdapter } from "../../src/server/providers/source/fixture";

async function loadFixture(service: IngestionService) {
  let cursor: string | undefined;
  const discoveries = [];
  do {
    const result = await service.discoverSource("fixture", { cursor, limit: 4 });
    discoveries.push(result);
    cursor = result.nextCursor;
  } while (cursor);
  return discoveries;
}

describe("Phase 2 ingestion pipeline", () => {
  it("ingests fixture pages idempotently and preserves raw versions", async () => {
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([[fixtureSourceAdapter.key, fixtureSourceAdapter]]));

    const pages = await loadFixture(service);
    expect(pages).toHaveLength(3);
    expect(repository.rawItems.size).toBe(9);
    expect(pages[0]?.rawDuplicates).toBe(0);
    expect(pages[1]?.rawDuplicates).toBe(1);
    expect([...repository.rawItems.values()].every((row) => row.fetch_job_run_id !== null)).toBe(true);
    expect([...repository.jobs.values()].every((row) => row.trace_id.length > 0)).toBe(true);
    expect(repository.health.get("fixture:test")?.degradation_state).toBe("healthy");
    expect([...repository.jobs.values()].every((job) => jsonValueSchema.safeParse(job.input_reference).success)).toBe(true);

    const sameRequest = await service.discoverSource("fixture", { limit: 4 });
    expect(sameRequest.jobRunId).toBe(pages[0]?.jobRunId);
    expect(repository.rawItems.size).toBe(9);

    const versions = [...repository.rawItems.values()].filter((row) => row.external_id === "same-id-changed");
    expect(versions).toHaveLength(2);
    expect(new Set(versions.map((row) => row.payload_hash)).size).toBe(2);
  });

  it("normalizes, canonicalizes, and keeps malformed records out of canonical state", async () => {
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([[fixtureSourceAdapter.key, fixtureSourceAdapter]]));
    await loadFixture(service);

    let failed = 0;
    for (const raw of repository.rawItems.values()) {
      try {
        const normalized = await service.normalizeRawSourceItem(raw.id, "fixture-v1");
        await service.canonicalizeSourceItem(normalized.sourceItemId, "canonical-v1");
      } catch {
        failed += 1;
      }
    }

    expect(failed).toBe(1);
    expect(repository.sourceItems.size).toBe(7);
    expect(repository.conversations.size).toBe(4);
    expect(repository.conversationSourceItems).toHaveLength(7);
    expect(repository.provenance.length).toBeGreaterThanOrEqual(15);

    const changed = [...repository.sourceItems.values()].find((row) => row.external_id === "same-id-changed");
    const changedRawVersions = [...repository.rawItems.values()]
      .filter((row) => row.external_id === "same-id-changed")
      .sort((left, right) => left.fetched_at.localeCompare(right.fetched_at));
    expect(changed?.body).toContain("provider changed");
    expect(changed?.latest_raw_source_item_id).toBe(changedRawVersions.at(-1)?.id);
    expect(repository.conversationSourceItems.some((row) => row.relation_type === "content_hash")).toBe(true);
  });

  it("replays raw history without discovery and is repeatable", async () => {
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([[fixtureSourceAdapter.key, fixtureSourceAdapter]]));
    await loadFixture(service);
    const beforeRaw = repository.rawItems.size;

    const first = await service.replay({ sourceKey: "fixture", normalizationVersion: "fixture-v2", canonicalizationVersion: "canonical-v2" });
    const second = await service.replay({ sourceKey: "fixture", normalizationVersion: "fixture-v2", canonicalizationVersion: "canonical-v2" });

    expect(first).toEqual({ normalized: 8, canonicalized: 8, failed: 1, rawItems: 9 });
    expect(second).toEqual(first);
    expect(repository.rawItems.size).toBe(beforeRaw);
    expect(repository.sourceItems.size).toBe(7);
    expect(repository.conversations.size).toBe(4);
  });

  it("hashes JSON independently of object key order", () => {
    expect(stableJsonStringify({ b: 2, a: 1 })).toBe(stableJsonStringify({ a: 1, b: 2 }));
    expect(sha256Json({ b: 2, a: 1 })).toBe(sha256Json({ a: 1, b: 2 }));
    expect(sha256Json({ body: "changed" })).not.toBe(sha256Json({ body: "original" }));
  });

  it("records sanitized source health failures and later recovery", async () => {
    const repository = new InMemoryIngestionRepository();
    const failingAdapter: SourceAdapter = {
      key: "failing",
      capabilities: { supportsSearch: false, supportsIncrementalCursor: true, supportsThreadExpansion: false },
      discover: async () => {
        throw new SourceAdapterError("TIMEOUT", "provider timed out with secret-token=actual-secret", true);
      },
      normalize: () => {
        throw new Error("not used");
      },
      healthCheck: async () => ({ sourceKey: "failing", ok: false, latencyMs: 20, degradationState: "degraded" as const, errorCode: "TIMEOUT", errorSummary: "provider timed out" }),
    };
    const service = new IngestionService(repository, new Map([[failingAdapter.key, failingAdapter], [fixtureSourceAdapter.key, fixtureSourceAdapter]]));

    await expect(service.discoverSource("failing", { limit: 1 })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(repository.health.get("failing:test")).toMatchObject({ degradation_state: "degraded", latest_error_code: "TIMEOUT" });
    expect(repository.health.get("failing:test")?.latest_error_summary).not.toContain("actual-secret");

    await service.discoverSource("fixture", { limit: 1 });
    expect(repository.health.get("fixture:test")?.degradation_state).toBe("healthy");
  });
});
