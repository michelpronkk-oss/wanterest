import type { SourceAdapter } from "./contracts";
import { blueskySourceAdapter } from "./bluesky";
import { fixtureSourceAdapter } from "./fixture";
import { hackerNewsSourceAdapter } from "./hacker-news";
import { redditSourceAdapter } from "./reddit";
import { githubSourceAdapter } from "./github";
import { xSourceAdapter } from "./x";

export function createSourceRegistry(adapters: SourceAdapter[] = [fixtureSourceAdapter, hackerNewsSourceAdapter, blueskySourceAdapter, redditSourceAdapter, githubSourceAdapter, xSourceAdapter]) {
  return new Map(adapters.map((adapter) => [adapter.key, adapter]));
}

export function getSourceAdapter(sourceKey: string, registry = createSourceRegistry()): SourceAdapter {
  const adapter = registry.get(sourceKey);
  if (!adapter) throw new Error(`Unknown source adapter: ${sourceKey}`);
  return adapter;
}
