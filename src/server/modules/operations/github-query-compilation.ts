import type { JsonObject } from "../../db/database.helpers";

export const githubPainRetrievalVersion = "github_pain_retrieval_v1" as const;

export type GithubPainQueryCompilation = {
  semanticQuery: string;
  providerQuery: string;
  templateVersion: typeof githubPainRetrievalVersion;
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

function contextStrings(context: Record<string, unknown>, key: string): string[] {
  const value = context[key];
  return (Array.isArray(value) ? value : [value])
    .map((item) => clean(item, 80))
    .filter(Boolean)
    .slice(0, 3);
}

function painPhraseFor(semanticQuery: string, category: string, context: Record<string, unknown>): string {
  const configuredPain = contextStrings(context, "pains")[0];
  if (configuredPain) return configuredPain;
  const withoutCategory = category ? semanticQuery.replace(new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ") : semanticQuery;
  return clean(withoutCategory, 80) || "struggling with";
}

/**
 * Compiles one semantic pain query into one bounded GitHub search expression.
 * The planner remains provider-neutral; this compiler is only called at the
 * GitHub request boundary for the pain_first surface.
 */
export function compileGithubPainQuery(input: { semanticQuery: string; metadata?: JsonObject }): GithubPainQueryCompilation {
  const context = providerContext(input.metadata ?? {});
  const category = contextCategory(context);
  const painPhrase = painPhraseFor(input.semanticQuery, category, context);
  const demand = [painPhrase];
  const categoryAnchors = [category];
  const providerQuery = `${quote(painPhrase)} ${quote(category)}`;
  return {
    semanticQuery: clean(input.semanticQuery, 180),
    providerQuery,
    templateVersion: githubPainRetrievalVersion,
    demandAnchors: demand,
    categoryAnchors,
  };
}

export function githubPainCompilationFromMetadata(metadata: JsonObject | undefined): GithubPainQueryCompilation | null {
  const value = metadata?.githubPainRetrievalV1;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.semanticQuery !== "string" || typeof candidate.providerQuery !== "string" || candidate.templateVersion !== githubPainRetrievalVersion) return null;
  const demand = Array.isArray(candidate.demandAnchors) ? candidate.demandAnchors.filter((item): item is string => typeof item === "string") : [];
  const category = Array.isArray(candidate.categoryAnchors) ? candidate.categoryAnchors.filter((item): item is string => typeof item === "string") : [];
  return { semanticQuery: candidate.semanticQuery, providerQuery: candidate.providerQuery, templateVersion: githubPainRetrievalVersion, demandAnchors: demand, categoryAnchors: category };
}

export function githubPainRetrievalDiagnostics(requests: Array<{ requestMetadata?: JsonObject }>): GithubPainQueryCompilation[] {
  return [...new Map(requests.map((request) => githubPainCompilationFromMetadata(request.requestMetadata)).filter((value): value is GithubPainQueryCompilation => Boolean(value)).map((value) => [value.semanticQuery, value])).values()];
}
