import type { SourceAdapter } from "./contracts";
import { blueskySourceAdapter } from "./bluesky";
import { fixtureSourceAdapter } from "./fixture";
import { hackerNewsSourceAdapter } from "./hacker-news";
import { redditSourceAdapter } from "./reddit";
import { githubSourceAdapter } from "./github";
import { xSourceAdapter } from "./x";
import { productHuntSourceAdapter } from "./product-hunt";
import { stackExchangeSourceAdapter } from "./stack-exchange";
import { publicWebSourceAdapter } from "./public-web";
import { g2SourceAdapter } from "./g2";
import { trustpilotSourceAdapter } from "./trustpilot";
import { youtubeSourceAdapter } from "./youtube";
import { gitlabSourceAdapter } from "./gitlab";

export function createSourceRegistry(adapters: SourceAdapter[] = [fixtureSourceAdapter, hackerNewsSourceAdapter, blueskySourceAdapter, redditSourceAdapter, githubSourceAdapter, xSourceAdapter, productHuntSourceAdapter, stackExchangeSourceAdapter, publicWebSourceAdapter, g2SourceAdapter, trustpilotSourceAdapter, youtubeSourceAdapter, gitlabSourceAdapter]) {
  return new Map(adapters.map((adapter) => [adapter.key, adapter]));
}

export function getSourceAdapter(sourceKey: string, registry = createSourceRegistry()): SourceAdapter {
  const adapter = registry.get(sourceKey);
  if (!adapter) throw new Error(`Unknown source adapter: ${sourceKey}`);
  return adapter;
}
