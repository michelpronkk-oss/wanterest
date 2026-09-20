import { z } from "zod";

import {
  rawSourceItemEnvelopeSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceItemCandidate,
} from "../contracts";
import {
  blueskyPostSchema,
  blueskyQuoteEmbedSchema,
  blueskyQuoteWithMediaEmbedSchema,
} from "./bluesky.schemas";

function atUriParts(uri: string): { actor: string; rkey: string } | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  return match ? { actor: match[1]!, rkey: match[2]! } : null;
}

function quoteReference(embed: unknown): { uri: string; cid: string } | null {
  const direct = blueskyQuoteEmbedSchema.safeParse(embed);
  if (direct.success) return direct.data.record;
  const withMedia = blueskyQuoteWithMediaEmbedSchema.safeParse(embed);
  return withMedia.success ? withMedia.data.record.record : null;
}

function embedType(embed: unknown): string | null {
  const parsed = z.object({ $type: z.string().trim().min(1).max(200) }).passthrough().safeParse(embed);
  return parsed.success ? parsed.data.$type : null;
}

export function normalizeBlueskyPost(raw: RawSourceItemEnvelope): SourceItemCandidate {
  const envelope = rawSourceItemEnvelopeSchema.parse(raw);
  const parsed = blueskyPostSchema.safeParse(envelope.payload);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Bluesky post failed validation.");
  const post = parsed.data;
  const uriParts = atUriParts(post.uri);
  if (!uriParts) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Bluesky post URI failed validation.");

  const replyRootUri = post.record.reply?.root.uri;
  const replyParentUri = post.record.reply?.parent.uri;
  const quote = quoteReference(post.record.embed);
  const actor = post.author.handle ?? post.author.did;

  return sourceItemCandidateSchema.parse({
    sourceKey: "bluesky",
    externalId: post.uri,
    externalConversationId: replyRootUri ?? post.uri,
    canonicalUrl: `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(uriParts.rkey)}`,
    authorExternalId: post.author.did,
    authorDisplayName: post.author.displayName,
    authorProfileUrl: `https://bsky.app/profile/${encodeURIComponent(actor)}`,
    body: post.record.text,
    publishedAt: post.record.createdAt,
    capturedAt: envelope.fetchedAt,
    language: post.record.langs?.[0],
    metadata: {
      did: post.author.did,
      handle: post.author.handle ?? null,
      cid: post.cid,
      atUri: post.uri,
      rkey: uriParts.rkey,
      replyRootUri: replyRootUri ?? null,
      replyParentUri: replyParentUri ?? null,
      quoteUri: quote?.uri ?? null,
      quoteCid: quote?.cid ?? null,
      embedType: embedType(post.record.embed),
      langs: post.record.langs ?? [],
      labels: post.labels?.map((label) => label.val) ?? [],
      likeCount: post.likeCount ?? null,
      repostCount: post.repostCount ?? null,
      replyCount: post.replyCount ?? null,
      quoteCount: post.quoteCount ?? null,
      contentHashDedupe: "allow",
    },
    status: "active",
  });
}
