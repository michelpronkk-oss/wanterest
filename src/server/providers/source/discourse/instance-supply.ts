export const DISCOURSE_INSTANCE_SUPPLY_VERSION = "discourse_instance_supply_v1" as const;

export const DISCOURSE_MAX_INSTANCES_PER_QUERY = 2;
export const DISCOURSE_MAX_QUERIES_PER_INSTANCE = 3;

export type DiscourseInstanceHealthStatus = "healthy" | "degraded" | "blocked" | "unknown";

export type DiscourseInstanceRegistryEntry = {
  key: string;
  baseUrl: string;
  enabled: boolean;
  publicAccessible: boolean;
  semanticTags: readonly string[];
  categoryTags: readonly string[];
  topicTags: readonly string[];
  language: string | null;
  healthStatus: DiscourseInstanceHealthStatus;
  lastSuccessAt: string | null;
  rationale: string;
};

/**
 * Small, reviewed, global infrastructure seed set. This is deliberately not
 * tenant input and is not an autonomous web-wide Discourse crawler.
 */
export const DISCOURSE_INSTANCE_REGISTRY_V1: readonly DiscourseInstanceRegistryEntry[] = [
  {
    key: "forum-obsidian-md",
    baseUrl: "https://forum.obsidian.md",
    enabled: true,
    publicAccessible: true,
    semanticTags: ["productivity", "knowledge management", "workflow", "organization", "note taking"],
    categoryTags: ["productivity software", "workflow software", "knowledge management", "project management"],
    topicTags: ["alternative", "recommendation", "feature request", "workflow friction", "adoption"],
    language: "en",
    healthStatus: "healthy",
    lastSuccessAt: null,
    rationale: "Public Discourse instance with generic productivity and workflow discussions; not Linear-specific.",
  },
] as const;

export type DiscourseInstanceSelectionQuery = {
  queryText: string;
  normalizedQuery?: string;
  queryFamily?: string;
  demandSurface?: string;
  conceptKeys?: readonly string[];
  providerContext?: Record<string, unknown>;
};

export type SelectedDiscourseInstance = DiscourseInstanceRegistryEntry & {
  selectionScore: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "best", "by", "for", "from", "how", "in", "is", "need", "of", "on", "or", "that", "the", "to", "too", "versus", "with",
  "category", "audience", "product", "software", "tool", "tools",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function tokenSet(values: readonly string[]): Set<string> {
  return new Set(values.flatMap(tokens));
}

function contextValues(query: DiscourseInstanceSelectionQuery): string[] {
  const context = query.providerContext ?? {};
  const values: string[] = [query.queryText, query.normalizedQuery ?? "", query.queryFamily ?? "", query.demandSurface ?? "", ...(query.conceptKeys ?? [])];
  for (const key of ["category", "audience", "pains", "feature_terms", "comparison_terms", "alternatives"]) {
    const value = context[key];
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === "string"));
  }
  return values;
}

function selectionScore(entry: DiscourseInstanceRegistryEntry, query: DiscourseInstanceSelectionQuery): number {
  const context = tokenSet(contextValues(query));
  if (!context.size) return 0;
  const category = tokenSet(entry.categoryTags);
  const semantic = tokenSet(entry.semanticTags);
  const topics = tokenSet(entry.topicTags);
  const categoryMatches = [...context].filter((token) => category.has(token)).length;
  const semanticMatches = [...context].filter((token) => semantic.has(token)).length;
  const topicMatches = [...context].filter((token) => topics.has(token)).length;
  return categoryMatches * 4 + semanticMatches * 2 + topicMatches;
}

function selectable(entry: DiscourseInstanceRegistryEntry): boolean {
  return entry.enabled && entry.publicAccessible && entry.healthStatus === "healthy" && Boolean(entry.baseUrl.trim());
}

export function hasSelectableDiscourseInstanceSupply(
  registry: readonly DiscourseInstanceRegistryEntry[] = DISCOURSE_INSTANCE_REGISTRY_V1,
): boolean {
  return registry.some(selectable);
}

export function selectDiscourseInstances(input: {
  query: DiscourseInstanceSelectionQuery;
  registry?: readonly DiscourseInstanceRegistryEntry[];
  maxInstances?: number;
}): SelectedDiscourseInstance[] {
  const maxInstances = Math.max(0, Math.min(DISCOURSE_MAX_INSTANCES_PER_QUERY, Math.floor(input.maxInstances ?? DISCOURSE_MAX_INSTANCES_PER_QUERY)));
  return (input.registry ?? DISCOURSE_INSTANCE_REGISTRY_V1)
    .filter(selectable)
    .map((entry) => ({ entry, selectionScore: selectionScore(entry, input.query) }))
    .filter(({ selectionScore }) => selectionScore > 0)
    .sort((left, right) => right.selectionScore - left.selectionScore || left.entry.key.localeCompare(right.entry.key))
    .slice(0, maxInstances)
    .map(({ entry, selectionScore }) => ({ ...entry, selectionScore }));
}
