import {
  rawSourceItemEnvelopeSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceItemCandidate,
} from "../contracts";
import { xRawItemPayloadSchema } from "./x.schemas";

function canonicalUrl(postId: string, username: string | undefined): string | undefined {
  if (!username) return undefined;
  return `https://x.com/${encodeURIComponent(username)}/status/${postId}`;
}

export function normalizeXItem(rawInput: RawSourceItemEnvelope): SourceItemCandidate {
  const raw = rawSourceItemEnvelopeSchema.parse(rawInput);
  const payload = xRawItemPayloadSchema.safeParse(raw.payload);
  if (!payload.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "X raw post payload failed validation.");
  const { tweet, author } = payload.data;
  if (author?.protected) throw new SourceAdapterError("PROTECTED_CONTENT", "Protected X posts are not supported.");
  const referencedTweets = tweet.referenced_tweets?.map((reference) => ({ type: reference.type, id: reference.id })) ?? [];
  const rootConversationId = tweet.conversation_id ?? tweet.id;
  return sourceItemCandidateSchema.parse({
    sourceKey: "x",
    externalId: tweet.id,
    externalConversationId: rootConversationId,
    canonicalUrl: canonicalUrl(tweet.id, author?.username),
    authorExternalId: tweet.author_id ? `x:user:${tweet.author_id}` : undefined,
    authorDisplayName: author?.name,
    authorProfileUrl: author?.username ? `https://x.com/${encodeURIComponent(author.username)}` : undefined,
    body: tweet.text,
    publishedAt: tweet.created_at,
    capturedAt: raw.fetchedAt,
    language: tweet.lang,
    metadata: {
      itemType: "post",
      postId: tweet.id,
      conversationId: rootConversationId,
      authorId: tweet.author_id ?? null,
      authorUsername: author?.username ?? null,
      authorDisplayName: author?.name ?? null,
      authorLocation: author?.location ?? null,
      replySettings: tweet.reply_settings ?? null,
      publicMetrics: tweet.public_metrics ?? null,
      referencedTweets,
      inReplyToUserId: tweet.in_reply_to_user_id ?? null,
      lang: tweet.lang ?? null,
      editHistoryTweetIds: tweet.edit_history_tweet_ids ?? [],
      possiblySensitive: tweet.possibly_sensitive ?? null,
      isReply: Boolean(tweet.in_reply_to_user_id),
      isQuote: referencedTweets.some((reference) => reference.type === "quoted"),
      isRetweet: referencedTweets.some((reference) => reference.type === "retweeted"),
    },
    status: "active",
  });
}
