import type { JsonObject } from "../../db/database.helpers";

export const githubPainRetrievalVersion = "github_pain_retrieval_v1_1" as const;
export const githubPainQueryMaxBooleanOperators = 4 as const;

export type GithubPainQueryCompilation = {
  semanticQuery: string;
  providerQuery: string;
  templateVersion: typeof githubPainRetrievalVersion;
  booleanOperatorCount: number;
  demandAnchors: string[];
  categoryAnchors: string[];
};

function clean(value: unknown, max = 100): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").replace(/["'`]/g, "").trim().slice(0, max) : "";
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function providerContext(query: JsonObject): Record<string, unknown> {
  const value = query.provider_context;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function contextCategory(context: Record<string, unknown>): string {
  const category = clean(context.category, 80);
  return category || "software tools";
}

function naturalCategoryAnchors(category: string): string[] {
  const normalized = category.toLowerCase();
  if (normalized.includes("project management")) return ["project management", "issue tracking"];
  if (normalized.includes("issue tracking")) return ["issue tracking", "project management"];
  const natural = category.replace(/\bsoftware\b/gi, "").replace(/\s+/g, " ").trim();
  return [natural || category].filter(Boolean).slice(0, 2);
}

function booleanOperatorCount(query: string): number {
  return query.match(/\b(?:AND|OR|NOT)\b/gi)?.length ?? 0;
}

function compileProviderQuery(demandAnchors: string[], categoryAnchors: string[]): { providerQuery: string; booleanOperatorCount: number; usedFallback: boolean; demandAnchors: string[]; categoryAnchors: string[] } {
  const demand = [...new Set(demandAnchors.map((value) => clean(value, 80)).filter(Boolean))];
  const category = [...new Set(categoryAnchors.map((value) => clean(value, 80)).filter(Boolean))];
  const grouped = `(${demand.map(quote).join(" OR ")}) (${category.map(quote).join(" OR ")})`.trim();
  const groupedOperatorCount = booleanOperatorCount(grouped);
  if (demand.length && category.length && groupedOperatorCount <= githubPainQueryMaxBooleanOperators) {
    return { providerQuery: grouped, booleanOperatorCount: groupedOperatorCount, usedFallback: false, demandAnchors: demand, categoryAnchors: category };
  }
  const fallbackDemand = demand[0] ?? "struggling with";
  const fallbackCategory = category[0] ?? "software tools";
  const providerQuery = `${quote(fallbackDemand)} ${quote(fallbackCategory)}`;
  return { providerQuery, booleanOperatorCount: booleanOperatorCount(providerQuery), usedFallback: true, demandAnchors: [fallbackDemand], categoryAnchors: [fallbackCategory] };
}

/**
 * Compiles one semantic pain query into one bounded GitHub search expression.
 * The planner remains provider-neutral; this compiler is only called at the
 * GitHub request boundary for the pain_first surface.
 */
export function compileGithubPainQuery(input: { semanticQuery: string; metadata?: JsonObject }): GithubPainQueryCompilation {
  const context = providerContext(input.metadata ?? {});
  const category = contextCategory(context);
  const compiled = compileProviderQuery(["looking for", "struggling with", "need"], naturalCategoryAnchors(category));
  return {
    semanticQuery: clean(input.semanticQuery, 180),
    providerQuery: compiled.providerQuery,
    templateVersion: githubPainRetrievalVersion,
    booleanOperatorCount: compiled.booleanOperatorCount,
    demandAnchors: compiled.demandAnchors,
    categoryAnchors: compiled.categoryAnchors,
  };
}

export function compileGithubPainProviderQueryForTest(input: { demandAnchors: string[]; categoryAnchors: string[] }) {
  return compileProviderQuery(input.demandAnchors, input.categoryAnchors);
}

export function githubPainCompilationFromMetadata(metadata: JsonObject | undefined): GithubPainQueryCompilation | null {
  const value = metadata?.githubPainRetrievalV1;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.semanticQuery !== "string" || typeof candidate.providerQuery !== "string" || candidate.templateVersion !== githubPainRetrievalVersion || typeof candidate.booleanOperatorCount !== "number") return null;
  const demand = Array.isArray(candidate.demandAnchors) ? candidate.demandAnchors.filter((item): item is string => typeof item === "string") : [];
  const category = Array.isArray(candidate.categoryAnchors) ? candidate.categoryAnchors.filter((item): item is string => typeof item === "string") : [];
  return { semanticQuery: candidate.semanticQuery, providerQuery: candidate.providerQuery, templateVersion: githubPainRetrievalVersion, booleanOperatorCount: candidate.booleanOperatorCount, demandAnchors: demand, categoryAnchors: category };
}

export function githubPainRetrievalDiagnostics(requests: Array<{ requestMetadata?: JsonObject }>): GithubPainQueryCompilation[] {
  return [...new Map(requests.map((request) => githubPainCompilationFromMetadata(request.requestMetadata)).filter((value): value is GithubPainQueryCompilation => Boolean(value)).map((value) => [value.semanticQuery, value])).values()];
}
