import { z } from "zod";

import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type RateLimitMetadata,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import { fetchJson, type SourceFetch } from "../http";

const gitlabAuthorSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  username: z.string().optional(),
  name: z.string().optional(),
  web_url: z.string().url().optional(),
  location: z.string().max(500).nullable().optional(),
}).passthrough().nullable().optional();

const gitlabProjectSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().optional(),
  path: z.string().optional(),
  path_with_namespace: z.string().optional(),
  web_url: z.string().url().optional(),
  description: z.string().nullable().optional(),
  visibility: z.string().optional(),
  namespace: z.object({ name: z.string().optional(), path: z.string().optional() }).passthrough().nullable().optional(),
}).passthrough();

const gitlabIssueSchema = z.object({
  id: z.number().int().nonnegative(),
  iid: z.number().int().positive(),
  project_id: z.number().int().nonnegative().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  web_url: z.string().url(),
  state: z.string().optional(),
  labels: z.array(z.string()).optional(),
  author: gitlabAuthorSchema,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  closed_at: z.string().nullable().optional(),
}).passthrough();

const gitlabNoteSchema = z.object({
  id: z.number().int().nonnegative(),
  body: z.string().optional(),
  author: gitlabAuthorSchema,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  system: z.boolean().optional(),
  discussion_id: z.string().optional(),
}).passthrough();

const gitlabDiscussionSchema = z.object({
  id: z.string(),
  individual_note: z.boolean().optional(),
  notes: z.array(z.unknown()),
}).passthrough();

const gitlabPayloadSchema = z.discriminatedUnion("itemType", [
  z.object({ itemType: z.literal("issue"), project: gitlabProjectSchema, issue: gitlabIssueSchema }).passthrough(),
  z.object({ itemType: z.literal("comment"), project: gitlabProjectSchema, issue: gitlabIssueSchema, note: gitlabNoteSchema, discussionId: z.string().optional() }).passthrough(),
]);

type GitLabProject = z.infer<typeof gitlabProjectSchema>;
type GitLabIssue = z.infer<typeof gitlabIssueSchema>;

export type GitLabSourceAdapterOptions = {
  token?: string;
  baseUrl?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

type GitLabMetrics = {
  requestCount: number;
  projectSearchRequests: number;
  issueSearchRequests: number;
  discussionRequests: number;
  projectsSelected: number;
  issuesSelected: number;
  commentsReturned: number;
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function mapProviderError(error: unknown): SourceAdapterError {
  if (!(error instanceof SourceAdapterError)) return new SourceAdapterError("TEMPORARY_FAILURE", "GitLab API request failed.", true);
  if (error.code === "HTTP_401" || error.code === "HTTP_403") return new SourceAdapterError("AUTH_FAILED", "GitLab API authentication failed.");
  if (error.code === "RATE_LIMITED") return new SourceAdapterError("RATE_LIMITED", "GitLab API rate limit reached.", true);
  if (error.code.startsWith("HTTP_5") || error.code === "TIMEOUT" || error.code === "REQUEST_FAILED") return new SourceAdapterError("TEMPORARY_FAILURE", "GitLab API is temporarily unavailable.", true);
  return error;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "GitLab provider error.";
}

export class GitLabSourceAdapter implements SourceAdapter {
  readonly key = "gitlab";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: false, supportsThreadExpansion: true } as const;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;

  constructor(options: GitLabSourceAdapterOptions = {}) {
    this.token = options.token ?? process.env.GITLAB_TOKEN?.trim() ?? "";
    this.baseUrl = (options.baseUrl ?? "https://gitlab.com/api/v4").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
    this.backoffMs = Math.min(500, Math.max(0, options.backoffMs ?? 100));
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!this.token) throw new SourceAdapterError("MISSING_CREDENTIALS", "GitLab token is not configured.");
    if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "GitLab discovery requires a bounded semantic query.");

    const metadata = request.requestMetadata as Record<string, unknown>;
    const maxProjects = boundedNumber(metadata.maxProjects, 2, 1, 5);
    const maxIssuesPerProject = boundedNumber(metadata.maxIssuesPerProject, Math.min(4, request.limit), 1, 8);
    const maxNotesPerIssue = boundedNumber(metadata.maxNotesPerIssue, Math.min(6, request.limit), 0, 15);
    const includeDiscussions = metadata.includeDiscussions !== false;
    const metrics: GitLabMetrics = { requestCount: 0, projectSearchRequests: 0, issueSearchRequests: 0, discussionRequests: 0, projectsSelected: 0, issuesSelected: 0, commentsReturned: 0 };
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = [];
    const issueIds = new Set<string>();
    const noteIds = new Set<string>();
    const projectResult = await this.searchProjects(request.query, maxProjects);
    metrics.requestCount += 1;
    metrics.projectSearchRequests += 1;
    const projects = projectResult.items
      .map((value) => gitlabProjectSchema.safeParse(value))
      .filter((result): result is { success: true; data: GitLabProject } => result.success && result.data.visibility !== "private" && result.data.visibility !== "internal")
      .map((result) => result.data)
      .filter((project, index, values) => values.findIndex((candidate) => candidate.id === project.id) === index)
      .slice(0, maxProjects);
    metrics.projectsSelected = projects.length;
    let rateLimit: RateLimitMetadata | undefined = projectResult.rateLimit;

    for (const project of projects) {
      if (items.length >= request.limit) break;
      let issuesResult: { items: unknown[]; rateLimit: RateLimitMetadata };
      try {
        issuesResult = await this.searchIssues(project.id, request.query, maxIssuesPerProject);
      } catch (error) {
        const mapped = mapProviderError(error);
        messages.push(`issues for gitlab:project:${project.id} unavailable: ${errorSummary(mapped)}`);
        if (mapped.code === "RATE_LIMITED") break;
        continue;
      }
      metrics.requestCount += 1;
      metrics.issueSearchRequests += 1;
      rateLimit = issuesResult.rateLimit;
      const issues = issuesResult.items
        .map((value) => gitlabIssueSchema.safeParse(value))
        .filter((result): result is { success: true; data: GitLabIssue } => result.success)
        .map((result) => result.data)
        .filter((issue, index, values) => values.findIndex((candidate) => `${project.id}:${candidate.iid}` === `${project.id}:${issue.iid}`) === index)
        .slice(0, maxIssuesPerProject);
      for (const issue of issues) {
        if (items.length >= request.limit) break;
        const issueExternalId = `gitlab:issue:${project.id}:${issue.iid}`;
        if (issueIds.has(issueExternalId)) continue;
        issueIds.add(issueExternalId);
        items.push(this.issueEnvelope(project, issue, request, metrics));
        metrics.issuesSelected += 1;
        if (!includeDiscussions || maxNotesPerIssue <= 0) continue;
        try {
          const discussions = await this.listDiscussions(project.id, issue.iid, maxNotesPerIssue);
          metrics.requestCount += 1;
          metrics.discussionRequests += 1;
          rateLimit = discussions.rateLimit;
          let notesAdded = 0;
          for (const discussionValue of discussions.items) {
            const discussion = gitlabDiscussionSchema.safeParse(discussionValue);
            if (!discussion.success) continue;
            for (const noteValue of discussion.data.notes) {
              if (notesAdded >= maxNotesPerIssue) break;
              const note = gitlabNoteSchema.safeParse(noteValue);
              if (!note.success || note.data.system === true || !note.data.body?.trim()) continue;
              const noteExternalId = `gitlab:comment:${project.id}:${note.data.id}`;
              if (noteIds.has(noteExternalId)) continue;
              noteIds.add(noteExternalId);
              if (items.length >= request.limit) break;
              items.push(this.commentEnvelope(project, issue, note.data, discussion.data.id, request, metrics));
              metrics.commentsReturned += 1;
              notesAdded += 1;
            }
          }
        } catch (error) {
          const mapped = mapProviderError(error);
          messages.push(`discussions for ${issueExternalId} unavailable: ${errorSummary(mapped)}`);
          if (mapped.code === "RATE_LIMITED") break;
        }
      }
    }

    for (const item of items) item.requestMetadata.metrics = { ...metrics };

    return {
      items,
      rateLimit,
      providerMetrics: { ...metrics },
      diagnostics: {
        accepted: items.length,
        rejected: 0,
        messages: [`GitLab searched ${metrics.projectsSelected} public project${metrics.projectsSelected === 1 ? "" : "s"} with bounded issue/discussion expansion; generic project chatter remains subject to demand qualification.`, ...messages],
      },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = gitlabPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitLab payload failed validation.");
    if (parsed.data.itemType === "issue") return this.normalizeIssue(envelope, parsed.data.project, parsed.data.issue);
    return this.normalizeComment(envelope, parsed.data.project, parsed.data.issue, parsed.data.note, parsed.data.discussionId);
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    if (!this.token) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "blocked", errorCode: "MISSING_CREDENTIALS", errorSummary: "GitLab token is not configured." };
    try {
      const result = await this.request("projects", { visibility: "public", simple: "true", per_page: "1" });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: result.rateLimit, degradationState: "healthy" };
    } catch (error) {
      const mapped = mapProviderError(error);
      const blocked = ["RATE_LIMITED", "AUTH_FAILED"].includes(mapped.code);
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: blocked ? "blocked" : "degraded", errorCode: mapped.code, errorSummary: errorSummary(mapped) };
    }
  }

  private async searchProjects(query: string, limit: number): Promise<{ items: unknown[]; rateLimit: RateLimitMetadata }> {
    const result = await this.request("projects", { search: query.slice(0, 180), visibility: "public", archived: "false", with_issues_enabled: "true", order_by: "last_activity_at", sort: "desc", per_page: String(Math.min(20, limit)) });
    if (!Array.isArray(result.body)) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitLab project response failed validation.");
    return { items: result.body, rateLimit: result.rateLimit };
  }

  private async searchIssues(projectId: number, query: string, limit: number): Promise<{ items: unknown[]; rateLimit: RateLimitMetadata }> {
    const result = await this.request(`projects/${encodeURIComponent(String(projectId))}/issues`, { search: query.slice(0, 180), scope: "all", state: "all", order_by: "updated_at", sort: "desc", with_labels_details: "true", per_page: String(Math.min(20, limit)) });
    if (!Array.isArray(result.body)) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitLab issue response failed validation.");
    return { items: result.body, rateLimit: result.rateLimit };
  }

  private async listDiscussions(projectId: number, issueIid: number, limit: number): Promise<{ items: unknown[]; rateLimit: RateLimitMetadata }> {
    const result = await this.request(`projects/${encodeURIComponent(String(projectId))}/issues/${issueIid}/discussions`, { per_page: String(Math.min(20, limit)), sort: "asc" });
    if (!Array.isArray(result.body)) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "GitLab discussion response failed validation.");
    return { items: result.body, rateLimit: result.rateLimit };
  }

  private async request(endpoint: string, params: Record<string, string>): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const url = new URL(`${this.baseUrl}/${endpoint}`);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        const response = await fetchJson(this.fetchImpl, url, { provider: "gitlab-rest", mode: "authenticated", headers: { "PRIVATE-TOKEN": this.token }, timeoutMs: this.timeoutMs });
        return { body: response.body, rateLimit: response.rateLimit };
      } catch (error) {
        lastError = mapProviderError(error);
        if (!(lastError instanceof SourceAdapterError) || !lastError.retryable || attempt >= this.maxAttempts) break;
        if (this.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    throw lastError instanceof SourceAdapterError ? lastError : new SourceAdapterError("TEMPORARY_FAILURE", "GitLab API request failed.", true);
  }

  private issueEnvelope(project: GitLabProject, issue: GitLabIssue, request: SourceDiscoveryRequest, metrics: GitLabMetrics): RawSourceItemEnvelope {
    return { sourceKey: this.key, externalId: `gitlab:issue:${project.id}:${issue.iid}`, fetchedAt: this.clock().toISOString(), payload: { itemType: "issue", project, issue }, requestMetadata: { provider: "gitlab-rest", endpoint: "/projects/:id/issues", query: request.query ?? null, metrics: { ...metrics } }, cursorContext: { itemType: "issue", projectId: project.id, issueIid: issue.iid, query: request.query ?? null } };
  }

  private commentEnvelope(project: GitLabProject, issue: GitLabIssue, note: z.infer<typeof gitlabNoteSchema>, discussionId: string, request: SourceDiscoveryRequest, metrics: GitLabMetrics): RawSourceItemEnvelope {
    return { sourceKey: this.key, externalId: `gitlab:comment:${project.id}:${note.id}`, fetchedAt: this.clock().toISOString(), payload: { itemType: "comment", project, issue, note, discussionId }, requestMetadata: { provider: "gitlab-rest", endpoint: "/projects/:id/issues/:issue_iid/discussions", query: request.query ?? null, metrics: { ...metrics } }, cursorContext: { itemType: "comment", projectId: project.id, issueIid: issue.iid, discussionId, rootExternalId: `gitlab:issue:${project.id}:${issue.iid}`, query: request.query ?? null } };
  }

  private normalizeIssue(envelope: RawSourceItemEnvelope, project: GitLabProject, issue: GitLabIssue): SourceItemCandidate {
    const externalId = `gitlab:issue:${project.id}:${issue.iid}`;
    return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId, externalConversationId: externalId, canonicalUrl: issue.web_url, authorExternalId: issue.author?.id !== undefined ? `gitlab:user:${issue.author.id}` : undefined, authorDisplayName: issue.author?.name ?? issue.author?.username, authorProfileUrl: issue.author?.web_url, title: issue.title, body: issue.description ?? issue.title, publishedAt: validDate(issue.created_at), capturedAt: envelope.fetchedAt, metadata: { sourceCategory: "developer_discussion", qualificationContext: "developer_discussion_not_demand_by_default", providerType: "issue", projectId: project.id, projectName: project.name ?? null, projectPath: project.path_with_namespace ?? null, projectUrl: project.web_url ?? null, projectDescription: project.description ?? null, issueIid: issue.iid, issueId: issue.id, authorLocation: issue.author?.location ?? null, labels: issue.labels ?? [], state: issue.state ?? null, createdAt: validDate(issue.created_at) ?? null, updatedAt: validDate(issue.updated_at) ?? null, closedAt: validDate(issue.closed_at ?? undefined) ?? null, query: envelope.requestMetadata.query ?? null }, status: "active" });
  }

  private normalizeComment(envelope: RawSourceItemEnvelope, project: GitLabProject, issue: GitLabIssue, note: z.infer<typeof gitlabNoteSchema>, discussionId?: string): SourceItemCandidate {
    const rootExternalId = `gitlab:issue:${project.id}:${issue.iid}`;
    return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId: `gitlab:comment:${project.id}:${note.id}`, externalConversationId: rootExternalId, canonicalUrl: `${issue.web_url}#note_${note.id}`, authorExternalId: note.author?.id !== undefined ? `gitlab:user:${note.author.id}` : undefined, authorDisplayName: note.author?.name ?? note.author?.username, authorProfileUrl: note.author?.web_url, title: issue.title, body: note.body ?? "", publishedAt: validDate(note.created_at), capturedAt: envelope.fetchedAt, metadata: { sourceCategory: "developer_discussion", qualificationContext: "developer_discussion_not_demand_by_default", providerType: "issue_comment", projectId: project.id, projectName: project.name ?? null, projectPath: project.path_with_namespace ?? null, projectUrl: project.web_url ?? null, issueIid: issue.iid, issueId: issue.id, authorLocation: note.author?.location ?? null, discussionId: discussionId ?? null, noteId: note.id, parentIssueExternalId: rootExternalId, query: envelope.requestMetadata.query ?? null, sourceUpdatedAt: validDate(note.updated_at) ?? null }, status: "active" });
  }
}

export const gitlabSourceAdapter = new GitLabSourceAdapter();
