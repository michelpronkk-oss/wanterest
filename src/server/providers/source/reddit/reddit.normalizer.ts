import {
  rawSourceItemEnvelopeSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceItemCandidate,
} from "../contracts";
import { redditCommentDataSchema, redditSubmissionDataSchema } from "./reddit.schemas";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fullname(kind: "t1" | "t3", id: string, name?: string): string {
  return name && new RegExp(`^${kind}_[A-Za-z0-9]+$`).test(name) ? name : `${kind}_${id}`;
}

function canonicalUrl(permalink: string | null | undefined): string | undefined {
  if (!permalink || !permalink.startsWith("/") || permalink.startsWith("//")) return undefined;
  try {
    const url = new URL(permalink, "https://www.reddit.com");
    if (url.origin !== "https://www.reddit.com" || !url.pathname.startsWith("/")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function contentState(body: string | null | undefined, removedByCategory?: string | null, removed?: boolean): "active" | "removed" | "deleted" {
  if (removed || removedByCategory || body === "[removed]") return "removed";
  if (body === "[deleted]") return "deleted";
  return "active";
}

function publishedAt(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

function rootFullname(raw: RawSourceItemEnvelope, fallback: string): string {
  return typeof raw.cursorContext.rootFullname === "string" && /^t3_[A-Za-z0-9]+$/.test(raw.cursorContext.rootFullname)
    ? raw.cursorContext.rootFullname
    : fallback;
}

export function normalizeRedditItem(rawInput: RawSourceItemEnvelope): SourceItemCandidate {
  const raw = rawSourceItemEnvelopeSchema.parse(rawInput);
  const payload = raw.payload;
  if (!payload || typeof payload !== "object" || !("kind" in payload) || !("data" in payload)) {
    throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Reddit item envelope is missing kind/data.");
  }
  const kind = payload.kind;
  const data = payload.data;
  if (kind === "t3") return normalizePost(raw, data);
  if (kind === "t1") return normalizeComment(raw, data);
  throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Reddit item kind is not supported.");
}

function normalizePost(raw: RawSourceItemEnvelope, value: unknown): SourceItemCandidate {
  const parsed = redditSubmissionDataSchema.safeParse(value);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Reddit submission failed validation.");
  const item = parsed.data;
  const externalId = fullname("t3", item.id, item.name);
  const state = contentState(item.selftext, item.removed_by_category, item.removed);
  const body = state === "active" && item.selftext && item.selftext !== "[deleted]" && item.selftext !== "[removed]" ? item.selftext : "";
  const title = item.title && item.title !== "[deleted]" && item.title !== "[removed]" ? item.title : undefined;
  return sourceItemCandidateSchema.parse({
    sourceKey: "reddit",
    externalId,
    externalConversationId: externalId,
    canonicalUrl: canonicalUrl(item.permalink),
    authorExternalId: stringValue(item.author_fullname) ?? stringValue(item.author),
    authorDisplayName: stringValue(item.author),
    authorProfileUrl: item.author ? `https://www.reddit.com/user/${encodeURIComponent(item.author)}` : undefined,
    title,
    body,
    publishedAt: publishedAt(item.created_utc),
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "post",
      id: item.id,
      fullname: externalId,
      subreddit: item.subreddit ?? null,
      subredditId: item.subreddit_id ?? null,
      subredditType: item.subreddit_type ?? null,
      permalink: item.permalink ?? null,
      score: item.score ?? null,
      numComments: item.num_comments ?? null,
      upvoteRatio: item.upvote_ratio ?? null,
      isSelf: item.is_self ?? null,
      domain: item.domain ?? null,
      flairText: item.link_flair_text ?? null,
      over18: item.over_18 ?? null,
      locked: item.locked ?? null,
      stickied: item.stickied ?? null,
      contentState: state,
      crosspostParent: item.crosspost_parent ?? null,
      crosspostCount: item.crosspost_parent_list?.length ?? 0,
    },
    status: state === "active" ? "active" : "removed",
  });
}

function normalizeComment(raw: RawSourceItemEnvelope, value: unknown): SourceItemCandidate {
  const parsed = redditCommentDataSchema.safeParse(value);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Reddit comment failed validation.");
  const item = parsed.data;
  const externalId = fullname("t1", item.id, item.name);
  const linkFullname = stringValue(item.link_id);
  const root = rootFullname(raw, linkFullname && /^t3_[A-Za-z0-9]+$/.test(linkFullname) ? linkFullname : `t3_${item.id}`);
  const state = contentState(item.body, item.removed_by_category);
  const body = state === "active" && item.body && item.body !== "[deleted]" && item.body !== "[removed]" ? item.body : "";
  return sourceItemCandidateSchema.parse({
    sourceKey: "reddit",
    externalId,
    externalConversationId: root,
    canonicalUrl: canonicalUrl(item.permalink),
    authorExternalId: stringValue(item.author_fullname) ?? stringValue(item.author),
    authorDisplayName: stringValue(item.author),
    authorProfileUrl: item.author ? `https://www.reddit.com/user/${encodeURIComponent(item.author)}` : undefined,
    body,
    publishedAt: publishedAt(item.created_utc),
    capturedAt: raw.fetchedAt,
    metadata: {
      itemType: "comment",
      id: item.id,
      fullname: externalId,
      parentFullname: item.parent_id ?? null,
      linkFullname: linkFullname ?? null,
      rootFullname: root,
      subreddit: item.subreddit ?? null,
      subredditId: item.subreddit_id ?? null,
      permalink: item.permalink ?? null,
      score: item.score ?? null,
      depth: item.depth ?? null,
      authorState: item.author ? "present" : "missing_or_deleted",
      contentState: state,
    },
    status: state === "active" ? "active" : "removed",
  });
}

export function redditExternalId(kind: "t1" | "t3", value: { id: string; name?: string }): string {
  return fullname(kind, value.id, value.name);
}
