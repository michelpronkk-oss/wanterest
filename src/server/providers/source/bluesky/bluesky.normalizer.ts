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

function externalReference(embed: unknown): { uri: string; title: string | null; description: string | null } | null {
  if (!embed || typeof embed !== "object" || Array.isArray(embed)) return null;
  const value = embed as Record<string, unknown>;
  const external = value.external && typeof value.external === "object" && !Array.isArray(value.external) ? value.external as Record<string, unknown> : null;
  if (!external || typeof external.uri !== "string") return null;
  try { new URL(external.uri); } catch { return null; }
  return { uri: external.uri, title: typeof external.title === "string" ? external.title : null, description: typeof external.description === "string" ? external.description : null };
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
  const external = externalReference(post.record.embed);
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
      authorLocation: post.author.location ?? null,
      cid: post.cid,
      atUri: post.uri,
      rkey: uriParts.rkey,
      replyRootUri: replyRootUri ?? null,
      replyParentUri: replyParentUri ?? null,
      quoteUri: quote?.uri ?? null,
      quoteCid: quote?.cid ?? null,
      embedType: embedType(post.record.embed),
      ...(external ? { externalUrl: external.uri, externalTitle: external.title, externalDescription: external.description } : {}),
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
