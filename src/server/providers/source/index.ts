export { createSourceRegistry, getSourceAdapter } from "./registry";
export { blueskySourceAdapter, BlueskySourceAdapter } from "./bluesky";
export { fixtureSourceAdapter, FixtureSourceAdapter } from "./fixture";
export { hackerNewsSourceAdapter, HackerNewsSourceAdapter } from "./hacker-news";
export {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
} from "./contracts";
export type {
  RawSourceItemEnvelope,
  SourceAdapter,
  SourceDiscoveryPage,
  SourceDiscoveryRequest,
  SourceHealthResult,
  SourceItemCandidate,
} from "./contracts";
