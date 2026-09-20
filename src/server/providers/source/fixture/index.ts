import { z } from "zod";

import type {
  RawSourceItemEnvelope,
  SourceAdapter,
  SourceDiscoveryPage,
  SourceDiscoveryRequest,
  SourceHealthResult,
  SourceItemCandidate,
} from "../contracts";
import { rawSourceItemEnvelopeSchema, sourceDiscoveryRequestSchema, sourceItemCandidateSchema, SourceAdapterError } from "../contracts";

const fixturePayloadSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["story", "comment"]),
  title: z.string().optional(),
  body: z.string().optional(),
  author: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      profileUrl: z.string().url().optional(),
    })
    .optional(),
  canonicalUrl: z.string().url().optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  rootId: z.string().optional(),
  parentId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const capturedAt = "2026-09-20T00:00:00.000Z";
const publishedAt = "2026-09-19T12:00:00.000Z";

function envelope(externalId: string, payload: unknown, cursor: string): RawSourceItemEnvelope {
  return {
    sourceKey: "fixture",
    externalId,
    fetchedAt: capturedAt,
    payload,
    requestMetadata: { adapter: "fixture", deterministic: true },
    cursorContext: { cursor },
  };
}

const pageOne: RawSourceItemEnvelope[] = [
  envelope(
    "standalone-1",
    {
      id: "standalone-1",
      type: "story",
      title: "A standalone demand signal",
      body: "I need a reliable way to reconcile this workflow.",
      author: { id: "author-1", name: "Ada", profileUrl: "https://fixture.test/users/author-1" },
      canonicalUrl: "https://fixture.test/posts/standalone-1",
      publishedAt,
      metadata: { case: "standalone" },
    },
    "page:1",
  ),
  envelope(
    "thread-root",
    {
      id: "thread-root",
      type: "story",
      title: "A thread with replies",
      body: "The root conversation describes a repeated problem.",
      author: { id: "author-root", name: "Root" },
      canonicalUrl: "https://fixture.test/posts/thread-root",
      publishedAt,
      rootId: "thread-root",
      metadata: { case: "thread-root" },
    },
    "page:1",
  ),
  envelope(
    "thread-reply-1",
    {
      id: "thread-reply-1",
      type: "comment",
      body: "The reply adds concrete detail.",
      author: { id: "author-reply", name: "Reply" },
      publishedAt: "2026-09-19T12:05:00.000Z",
      rootId: "thread-root",
      parentId: "thread-root",
      metadata: { case: "thread-reply" },
    },
    "page:1",
  ),
  envelope(
    "standalone-duplicate",
    {
      id: "standalone-duplicate",
      type: "story",
      title: "A standalone demand signal",
      body: "I need a reliable way to reconcile this workflow.",
      publishedAt,
      metadata: { case: "duplicate-content" },
    },
    "page:1",
  ),
  envelope(
    "same-id-changed",
    {
      id: "same-id-changed",
      type: "story",
      title: "Version one",
      body: "The first payload version.",
      publishedAt,
      metadata: { version: "one" },
    },
    "page:1",
  ),
  envelope(
    "same-id-changed",
    {
      id: "same-id-changed",
      type: "story",
      title: "Version one",
      body: "The first payload version.",
      publishedAt,
      metadata: { version: "one" },
    },
    "page:1",
  ),
  envelope(
    "missing-author",
    {
      id: "missing-author",
      type: "story",
      title: "Optional metadata is absent",
      body: "This fixture intentionally has no author or canonical URL.",
      publishedAt,
      metadata: { case: "missing-optional" },
    },
    "page:1",
  ),
  envelope("malformed-provider-payload", { id: "malformed-provider-payload", unexpected: true }, "page:1"),
];

const pageTwo: RawSourceItemEnvelope[] = [
  envelope(
    "thread-reply-2",
    {
      id: "thread-reply-2",
      type: "comment",
      body: "A second reply keeps the same root identity.",
      publishedAt: "2026-09-19T12:10:00.000Z",
      rootId: "thread-root",
      parentId: "thread-reply-1",
      metadata: { case: "thread-reply" },
    },
    "page:2",
  ),
  envelope(
    "same-id-changed",
    {
      id: "same-id-changed",
      type: "story",
      title: "Version two",
      body: "The provider changed the meaningful payload.",
      publishedAt,
      metadata: { version: "two" },
    },
    "page:2",
  ),
];

export class FixtureSourceAdapter implements SourceAdapter {
  readonly key = "fixture";
  readonly capabilities = {
    supportsSearch: false,
    supportsIncrementalCursor: true,
    supportsThreadExpansion: true,
  } as const;

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const cursor = request.cursor ?? "page:1:0";
    const match = /^page:(1|2)(?::(\d+))?$/.exec(cursor);
    if (request.cursor && !match) throw new SourceAdapterError("INVALID_CURSOR", "Fixture cursor is invalid.");
    const pageNumber = match ? Number(match[1]) : 1;
    const offset = match?.[2] ? Number(match[2]) : 0;
    const page = pageNumber === 1 ? pageOne : pageTwo;
    const bounded = page.slice(offset, offset + request.limit);
    const nextOffset = offset + bounded.length;
    const hasMoreOnPage = nextOffset < page.length;
    return {
      items: bounded,
      nextCursor: hasMoreOnPage ? `page:${pageNumber}:${nextOffset}` : pageNumber === 1 ? "page:2" : undefined,
      rateLimit: { provider: "fixture", remaining: 999, limit: 1000, retryAfterMs: null },
      diagnostics: { accepted: bounded.length, rejected: 0, messages: [] },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = fixturePayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Fixture payload failed validation.");
    }
    const payload = parsed.data;
    const candidate = sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: raw.externalId,
      externalConversationId: payload.rootId,
      canonicalUrl: payload.canonicalUrl,
      authorExternalId: payload.author?.id,
      authorDisplayName: payload.author?.name,
      authorProfileUrl: payload.author?.profileUrl,
      title: payload.title,
      body: payload.body ?? payload.title ?? "",
      publishedAt: payload.publishedAt,
      capturedAt: raw.fetchedAt,
      metadata: {
        ...payload.metadata,
        parentId: payload.parentId ?? null,
        rootId: payload.rootId ?? null,
      },
      status: "active",
    });
    return candidate;
  }

  async healthCheck(): Promise<SourceHealthResult> {
    return {
      sourceKey: this.key,
      ok: true,
      latencyMs: 0,
      rateLimit: { provider: "fixture", remaining: 999, limit: 1000, retryAfterMs: null },
      degradationState: "healthy",
    };
  }
}

export const fixtureSourceAdapter = new FixtureSourceAdapter();
