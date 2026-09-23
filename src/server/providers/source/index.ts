export { createSourceRegistry, getSourceAdapter } from "./registry";
export { blueskySourceAdapter, BlueskySourceAdapter } from "./bluesky";
export { fixtureSourceAdapter, FixtureSourceAdapter } from "./fixture";
export { hackerNewsSourceAdapter, HackerNewsSourceAdapter } from "./hacker-news";
export { redditSourceAdapter, RedditSourceAdapter, RedditClient, RedditTokenManager, normalizeRedditItem } from "./reddit";
export { githubSourceAdapter, GitHubSourceAdapter, GitHubClient, normalizeGitHubItem } from "./github";
export { xSourceAdapter, XSourceAdapter, XClient, estimateXReadCost, normalizeXItem } from "./x";
export { productHuntSourceAdapter, ProductHuntSourceAdapter } from "./product-hunt";
export { stackExchangeSourceAdapter, StackExchangeSourceAdapter } from "./stack-exchange";
export { publicWebSourceAdapter, PublicWebSourceAdapter } from "./public-web";
export { g2SourceAdapter, G2SourceAdapter, G2ProductResolver } from "./g2";
export type { G2ProductMapping, G2ProductMappings, G2ProductResolutionTarget } from "./g2";
export { trustpilotSourceAdapter, TrustpilotSourceAdapter } from "./trustpilot";
export { youtubeSourceAdapter, YouTubeSourceAdapter } from "./youtube";
export { gitlabSourceAdapter, GitLabSourceAdapter } from "./gitlab";
export { sourceRuntimeConfigurations, getSourceRuntimeConfiguration } from "./runtime";
export { normalizeReviewRecord, stableReviewExternalId } from "./reviews";
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
export type { ReviewRecord } from "./reviews";
