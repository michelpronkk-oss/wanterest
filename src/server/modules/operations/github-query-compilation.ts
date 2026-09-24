import type { JsonObject } from "../../db/database.helpers";

export const githubPainRetrievalVersion = "github_pain_retrieval_v1" as const;

export type GithubPainQueryCompilation = {
  semanticQuery: string;
  providerQuery: string;
  templateVersion: typeof githubPainRetrievalVersion;
  demandAnchors: string[];
  categoryAnchors: string[];
};

const demandAnchors = [
  "struggling with",
  "problem with",
  "looking for",
  "need a better",
  "replace",
  "too complex",
  "missing",
] as const;

const categoryExpansions: Array<{ matches: string[]; anchors: string[] }> = [
  {
    matches: ["project management", "issue tracking", "software development"],
    anchors: ["project management software", "issue tracking", "software development"],
  },
  {
    matches: ["software development", "developer tools", "developer tool"],
    anchors: ["software development", "developer tools", "issue tracking"],
  },
];

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

function categoryAnchorsFor(category: string): string[] {
  const normalized = category.toLowerCase();
  const expansion = categoryExpansions.find((candidate) => candidate.matches.some((match) => normalized.includes(match)));
  const values = expansion?.anchors ?? [category];
  return [...new Set(values.map((value) => clean(value, 80)).filter(Boolean))].slice(0, 4);
}

/**
 * Compiles one semantic pain query into one bounded GitHub search expression.
 * The planner remains provider-neutral; this compiler is only called at the
 * GitHub request boundary for the pain_first surface.
 */
export function compileGithubPainQuery(input: { semanticQuery: string; metadata?: JsonObject }): GithubPainQueryCompilation {
  const context = providerContext(input.metadata ?? {});
  const categoryAnchors = categoryAnchorsFor(contextCategory(context));
  const demand = [...demandAnchors];
  const providerQuery = `(${demand.map(quote).join(" OR ")}) (${categoryAnchors.map(quote).join(" OR ")})`;
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
