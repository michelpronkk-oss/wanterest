import { buildQueryPlan, buildQueryPlanSeedCandidates } from "./query-planning.service";
import type { QueryPlan, QueryPlanQuery, QueryPlanningInput } from "./query-planning.schemas";

export const queryPlanningV8Version = "query_planning_v8" as const;

const COMPETITOR_SURFACES = new Set<QueryPlanQuery["demand_surface"]>(["switching", "alternative_search", "competitor_pain"]);
const PAIN_LEAD_IN = /^(?:struggling with|problem with|issues with|issue with|having trouble with)\s+/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lowerFirst(value: string): string {
  return value.length ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 90) || "query";
}

function providerContext(query: QueryPlanQuery): { category?: string; audience?: string } {
  const metadata = query.metadata as Record<string, unknown>;
  const context = metadata.provider_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const record = context as Record<string, unknown>;
  return {
    category: typeof record.category === "string" ? clean(record.category) : undefined,
    audience: typeof record.audience === "string" ? clean(record.audience) : undefined,
  };
}

function canonicalQueryText(query: QueryPlanQuery): string {
  const context = providerContext(query);
  const category = context.category ?? "software";
  let text = clean(query.query_text);

  if (query.query_family === "pain") {
    const withoutLeadIn = lowerFirst(text.replace(PAIN_LEAD_IN, ""));
    const categoryPrefix = normalize(category);
    const normalized = normalize(withoutLeadIn);
    const pain = normalized.startsWith(categoryPrefix) ? withoutLeadIn.slice(category.length).trim() : withoutLeadIn;
    if (query.source_key === "hacker-news") {
      const conciseCategory = category.replace(/\s+software$/i, "");
      text = pain ? `${lowerFirst(pain)} in ${conciseCategory}` : lowerFirst(category);
    } else {
      text = pain ? `${category} with ${lowerFirst(pain)}` : category;
    }
  } else if (query.query_family === "jtbd") {
    text = text.replace(/\bto\s+([A-Z])/g, (_, first: string) => `to ${first.toLowerCase()}`);
  } else if (query.source_key === "hacker-news") {
    text = lowerFirst(text);
  }

  return clean(text);
}

function semanticTemplateKey(query: QueryPlanQuery, text: string): string {
  const normalized = normalize(text).replace(PAIN_LEAD_IN, "");
  return `${query.query_family}:${normalized}`;
}

function isCompetitorQuery(query: QueryPlanQuery): boolean {
  return query.competitor_specific || COMPETITOR_SURFACES.has(query.demand_surface);
}

function qualityQuery(query: QueryPlanQuery, text: string, duplicateSuppressed: boolean): QueryPlanQuery {
  const normalized = normalize(text);
  const metadata = query.metadata as Record<string, unknown>;
  return {
    ...query,
    query_id: `qp-v8-${query.source_key}-${slug(query.query_family)}-${slug(normalized)}`,
    query_text: text,
    normalized_query: normalized,
    metadata: {
      ...metadata,
      planner_version: queryPlanningV8Version,
      planner_quality: {
        ...(typeof metadata.planner_quality === "object" && metadata.planner_quality && !Array.isArray(metadata.planner_quality) ? metadata.planner_quality : {}),
        semantic_template_key: semanticTemplateKey(query, text),
        canonicalized: text !== query.query_text,
        duplicate_suppressed: duplicateSuppressed,
      },
    },
  };
}

function dedupeSourceQueries(queries: QueryPlanQuery[]): { queries: QueryPlanQuery[]; suppressed: number } {
  const seen = new Set<string>();
  const result: QueryPlanQuery[] = [];
  let suppressed = 0;
  for (const query of queries) {
    const text = canonicalQueryText(query);
    const key = semanticTemplateKey(query, text);
    if (seen.has(key)) {
      suppressed += 1;
      continue;
    }
    seen.add(key);
    result.push(qualityQuery(query, text, false));
  }
  return { queries: result, suppressed };
}

function competitorBudget(nonCompetitorCount: number, competitorCount: number): number {
  if (!competitorCount) return 0;
  if (!nonCompetitorCount) return 1;
  return Math.max(1, Math.floor((nonCompetitorCount * 0.35) / 0.65));
}

function applyCompetitorAllocation(sourcePlans: QueryPlan["source_plans"]): { sourcePlans: QueryPlan["source_plans"]; suppressed: number } {
  const all = sourcePlans.flatMap((source) => source.queries);
  const competitors = all.filter(isCompetitorQuery).sort((left, right) => right.confidence - left.confidence || left.source_key.localeCompare(right.source_key) || left.query_id.localeCompare(right.query_id));
  const nonCompetitors = all.filter((query) => !isCompetitorQuery(query));
  const keep = new Set(competitors.slice(0, competitorBudget(nonCompetitors.length, competitors.length)).map((query) => query.query_id));
  const suppressed = competitors.length - keep.size;
  return {
    sourcePlans: sourcePlans.map((source) => {
      const queries = source.queries.filter((query) => !isCompetitorQuery(query) || keep.has(query.query_id));
      return { ...source, queries, query_budget: queries.length };
    }),
    suppressed,
  };
}

function finalizePlan(plan: QueryPlan): QueryPlan {
  const deduped = plan.source_plans.map((source) => dedupeSourceQueries(source.queries));
  const allocation = applyCompetitorAllocation(plan.source_plans.map((source, index) => ({ ...source, queries: deduped[index]!.queries, query_budget: deduped[index]!.queries.length })));
  const queries = allocation.sourcePlans.flatMap((source) => source.queries);
  const familyDistribution: Record<string, number> = {};
  const surfaceCoverage: Record<string, "covered" | "uncovered"> = {};
  const queriesPerSource: Record<string, number> = {};
  const budgetPerSource: Record<string, number> = {};
  for (const source of allocation.sourcePlans) {
    queriesPerSource[source.source_key] = source.queries.length;
    budgetPerSource[source.source_key] = source.queries.reduce((sum, query) => sum + query.candidate_budget, 0);
    for (const query of source.queries) {
      familyDistribution[query.query_family] = (familyDistribution[query.query_family] ?? 0) + 1;
      surfaceCoverage[query.demand_surface] = "covered";
    }
  }
  const duplicateSuppressed = deduped.reduce((sum, result) => sum + result.suppressed, 0) + allocation.suppressed;
  return {
    ...plan,
    version: queryPlanningV8Version,
    source_plans: allocation.sourcePlans,
    diagnostics: {
      ...plan.diagnostics,
      query_count: queries.length,
      query_family_distribution: familyDistribution,
      demand_surface_coverage: Object.fromEntries(Object.entries(surfaceCoverage).sort(([left], [right]) => left.localeCompare(right))),
      queries_per_source: queriesPerSource,
      candidate_budget_per_source: budgetPerSource,
      suppressed_duplicate_count: plan.diagnostics.suppressed_duplicate_count + duplicateSuppressed,
      messages: [...plan.diagnostics.messages, `Applied ${queryPlanningV8Version} canonical language, template dedupe, and bounded competitor allocation.`],
    },
  };
}

export function buildQueryPlanV8(input: QueryPlanningInput): QueryPlan {
  return finalizePlan(buildQueryPlan(input));
}

export function buildQueryPlanSeedCandidatesV8(input: QueryPlanningInput, sourceKeys: readonly string[]): QueryPlanQuery[] {
  const candidates = buildQueryPlanSeedCandidates(input, sourceKeys);
  const bySource = new Map<string, QueryPlanQuery[]>();
  for (const candidate of candidates) bySource.set(candidate.source_key, [...(bySource.get(candidate.source_key) ?? []), candidate]);
  const deduped = [...bySource.values()].flatMap((sourceCandidates) => dedupeSourceQueries(sourceCandidates).queries);
  const nonCompetitors = deduped.filter((query) => !isCompetitorQuery(query));
  const competitors = deduped.filter(isCompetitorQuery).sort((left, right) => right.confidence - left.confidence || left.source_key.localeCompare(right.source_key) || left.query_id.localeCompare(right.query_id));
  const keep = new Set(competitors.slice(0, competitorBudget(nonCompetitors.length, competitors.length)).map((query) => query.query_id));
  return deduped.filter((query) => !isCompetitorQuery(query) || keep.has(query.query_id));
}
