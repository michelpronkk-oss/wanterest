import { sourceDiscoveryRequestSchema, type SourceDiscoveryRequest } from "../../providers/source/contracts";
import { X_PROVIDER_MIN_RESULTS } from "../../providers/source/x/x.cost";
import { compileXQuery } from "../../providers/source/x/x.query";
import { queryPlanningVersion, type QueryPlanQuery, type QueryPlanSource } from "./query-planning.schemas";
import { compileGithubPainQuery } from "./github-query-compilation";

export type SourceQueryExecutionInput = {
  sourcePlan: QueryPlanSource;
  query: QueryPlanQuery;
  maxPages: number;
};

/**
 * Converts semantic Query Planning output to the existing source request port.
 * Provider syntax stays here; the planner itself never emits X operators or
 * provider-specific search qualifiers.
 */
export function toSourceDiscoveryRequest(input: SourceQueryExecutionInput): SourceDiscoveryRequest {
  const { sourcePlan, query } = input;
  const metadata: Record<string, unknown> = {
    queryPlanVersion: queryPlanningVersion,
    queryPlanId: query.query_id,
    semanticQuery: query.query_text,
    queryFamily: query.query_family,
    demandSurface: query.demand_surface,
    competitorSpecific: query.competitor_specific,
    discoveryIntent: query.metadata.discovery_intent ?? null,
    queryIntent: query.intent_type,
  };

  if (sourcePlan.source_key === "x") {
    const providerContext = query.metadata.provider_context;
    const compiled = compileXQuery({
      semanticQuery: query.query_text,
      family: query.query_family,
      context: providerContext && typeof providerContext === "object" && !Array.isArray(providerContext) ? providerContext as Parameters<typeof compileXQuery>[0]["context"] : undefined,
    });
    metadata.maxResults = query.candidate_budget;
    metadata.maxPages = Math.min(2, Math.max(1, input.maxPages));
    // X requires a ten-post provider page. Keep the planned candidate cap for
    // surfaced results, but reserve one provider-minimum page so a funded
    // account is not skipped before the API can confirm availability.
    metadata.maxBillablePostsPerDiscovery = Math.max(query.candidate_budget, X_PROVIDER_MIN_RESULTS);
    metadata.excludeRetweets = true;
    metadata.providerQuery = compiled.query;
    if (compiled.usedFallback) metadata.queryCompilationFallback = compiled.diagnostic ?? true;
    if (query.language_context) metadata.lang = query.language_context;
    return sourceDiscoveryRequestSchema.parse({
      limit: Math.max(1, Math.min(100, query.candidate_budget)),
      query: compiled.query,
      requestMetadata: metadata,
    });
  } else if (sourcePlan.source_key === "reddit") {
    metadata.sort = "relevance";
    metadata.excludeNsfw = true;
  } else if (sourcePlan.source_key === "github") {
    metadata.contentType = "all";
    metadata.includeComments = false;
    // The combined endpoint has no shared issue/discussion cursor. Keep it at
    // one page until the two lanes can be persisted as separate queries.
    metadata.maxPages = 1;
    if (query.demand_surface === "pain_first") {
      const compiled = compileGithubPainQuery({ semanticQuery: query.query_text, metadata: query.metadata });
      metadata.githubPainRetrievalV1 = compiled;
      return sourceDiscoveryRequestSchema.parse({
        limit: Math.max(1, Math.min(100, query.candidate_budget)),
        query: compiled.providerQuery,
        requestMetadata: metadata,
      });
    }
  } else if (sourcePlan.source_key === "hacker-news") {
    // HN has no search endpoint. The adapter applies a bounded lexical filter
    // to the recent feed using these anchors, while retaining the semantic
    // query for diagnostics.
    metadata.executionMode = "filtered_newstories_feed";
    metadata.searchUnsupported = true;
    metadata.maxPages = Math.min(3, Math.max(1, input.maxPages));
    const providerContext = query.metadata.provider_context;
    if (providerContext && typeof providerContext === "object" && !Array.isArray(providerContext)) {
      const context = providerContext as Record<string, unknown>;
      metadata.lexicalAnchors = [
        ...(Array.isArray(context.competitors) ? context.competitors : []),
        ...(Array.isArray(context.product_name) ? context.product_name : typeof context.product_name === "string" ? [context.product_name] : []),
        ...(Array.isArray(context.category) ? context.category : typeof context.category === "string" ? [context.category] : []),
        ...(Array.isArray(context.alternatives) ? context.alternatives : []),
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    }
  } else if (sourcePlan.source_key === "product-hunt") {
    metadata.includeComments = true;
    metadata.maxCommentsPerPost = 10;
  } else if (sourcePlan.source_key === "stack-exchange") {
    metadata.site = "stackoverflow";
    metadata.maxPages = Math.min(2, Math.max(1, input.maxPages));
  } else if (sourcePlan.source_key === "g2" || sourcePlan.source_key === "trustpilot") {
    metadata.reviewImport = true;
    if (sourcePlan.source_key === "g2") {
      const providerContext = query.metadata.provider_context;
      const context = providerContext && typeof providerContext === "object" && !Array.isArray(providerContext) ? providerContext as Record<string, unknown> : {};
      const productName = typeof context.product_name === "string" ? context.product_name : undefined;
      const competitorTargets = Array.isArray(context.competitor_targets) ? context.competitor_targets : [];
      const alternativeTargets = Array.isArray(context.alternative_targets) ? context.alternative_targets : [];
      const refs = new Set([...query.competitor_refs, ...query.alternative_refs]);
      const targets = [
        ...(productName ? [{ key: "product", kind: "product", name: productName }] : []),
        ...competitorTargets.filter((value) => {
          const target = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
          return typeof target.key === "string" && refs.has(target.key);
        }),
        ...alternativeTargets.filter((value) => {
          const target = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
          return typeof target.key === "string" && refs.has(target.key);
        }),
      ];
      metadata.g2Targets = targets.length ? targets : productName ? [{ key: "product", kind: "product", name: productName }] : [];
    }
  } else if (sourcePlan.source_key === "youtube") {
    metadata.maxVideos = Math.min(5, Math.max(1, query.candidate_budget));
    metadata.maxCommentsPerVideo = Math.min(12, Math.max(3, Math.ceil(query.candidate_budget / Math.max(1, Math.min(5, query.candidate_budget)))));
    metadata.includeReplies = false;
    metadata.maxPages = Math.min(2, Math.max(1, input.maxPages));
    metadata.providerQuery = query.query_text;
  } else if (sourcePlan.source_key === "gitlab") {
    metadata.maxProjects = Math.min(3, Math.max(1, Math.ceil(query.candidate_budget / 4)));
    metadata.maxIssuesPerProject = Math.min(5, Math.max(1, query.candidate_budget));
    metadata.maxNotesPerIssue = Math.min(8, Math.max(2, Math.ceil(query.candidate_budget / 2)));
    metadata.includeDiscussions = true;
    metadata.maxPages = Math.min(2, Math.max(1, input.maxPages));
    metadata.providerQuery = query.query_text;
  } else if (sourcePlan.source_key === "public-web") {
    metadata.discoveryRequirement = "explicit_public_urls";
  } else if (sourcePlan.source_key === "bluesky" && query.language_context) {
    metadata.lang = query.language_context;
  }

  return sourceDiscoveryRequestSchema.parse({
    limit: Math.max(1, Math.min(100, query.candidate_budget)),
    query: query.query_text,
    requestMetadata: metadata,
  });
}
