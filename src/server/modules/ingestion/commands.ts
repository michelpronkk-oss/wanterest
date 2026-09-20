import "server-only";

import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseIngestionRepository } from "./ingestion.repository";
import { IngestionService } from "./ingestion.service";
import { SourceControlService, SupabaseSourceControlStore } from "../operations/source-control.service";

function createService(): IngestionService {
  return new IngestionService(
    new SupabaseIngestionRepository(createSupabaseServiceClient()),
    undefined,
    new SourceControlService(new SupabaseSourceControlStore(createSupabaseServiceClient())),
  );
}

export async function runFixturePipeline(input: { limit?: number; normalizationVersion?: string; canonicalizationVersion?: string } = {}) {
  const service = createService();
  const discoveries = [];
  let cursor: string | undefined;
  do {
    const result = await service.discoverSource("fixture", { cursor, limit: input.limit ?? 25 });
    discoveries.push(result);
    cursor = result.nextCursor;
  } while (cursor);
  const replay = await service.replay({
    sourceKey: "fixture",
    normalizationVersion: input.normalizationVersion ?? "fixture-v1",
    canonicalizationVersion: input.canonicalizationVersion ?? "canonical-v1",
  });
  return { discoveries, replay };
}

export async function runHackerNewsSmoke(input: { limit?: number; expandThreads?: boolean } = {}) {
  const service = createService();
  const discovery = await service.discoverSource("hacker-news", {
    limit: Math.min(input.limit ?? 5, 10),
    expandThreads: input.expandThreads ?? false,
  });
  const replay = await service.replay({
    sourceKey: "hacker-news",
    normalizationVersion: "hacker-news-v1",
    canonicalizationVersion: "canonical-v1",
    limit: Math.min(input.limit ?? 5, 10),
  });
  const health = await service.healthCheck("hacker-news");
  return { discovery, replay, health };
}

export async function runBlueskySmoke(input: { query?: string; limit?: number } = {}) {
  const service = createService();
  const limit = Math.min(input.limit ?? 10, 20);
  const query = input.query ?? "looking for crm automation";
  const discovery = await service.discoverSource("bluesky", { query, limit });
  const replay = await service.replay({
    sourceKey: "bluesky",
    normalizationVersion: "bluesky-v1",
    canonicalizationVersion: "canonical-v1",
    limit: 20,
  });
  const health = await service.healthCheck("bluesky");
  return { query, discovery, replay, health };
}

export async function runRedditSmoke(input: { query?: string; subreddit?: string; limit?: number; expandThreads?: boolean } = {}) {
  const service = createService();
  const limit = Math.min(input.limit ?? 5, 10);
  const discovery = await service.discoverSource("reddit", {
    query: input.query ?? "test",
    limit,
    expandThreads: input.expandThreads ?? false,
    requestMetadata: input.subreddit ? { subreddit: input.subreddit } : {},
  });
  const replay = await service.replay({
    sourceKey: "reddit",
    normalizationVersion: "reddit-v1",
    canonicalizationVersion: "canonical-v1",
    limit: 100,
  });
  const health = await service.healthCheck("reddit");
  return { query: input.query ?? "test", discovery, replay, health };
}

export async function replaySource(input: unknown) {
  return createService().replay(input);
}
