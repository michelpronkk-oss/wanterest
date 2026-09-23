import { createHash } from "node:crypto";

import { sourceItemCandidateSchema, type SourceItemCandidate } from "../contracts";
import { reviewRecordSchema, type ReviewRecord } from "./contracts";

export function stableReviewExternalId(sourceKey: string, review: Pick<ReviewRecord, "externalId" | "text" | "publishedAt">): string {
  if (review.externalId.trim()) return review.externalId.trim().slice(0, 500);
  const seed = `${sourceKey}|${review.publishedAt ?? ""}|${review.text}`;
  return `review:${createHash("sha256").update(seed, "utf8").digest("hex")}`;
}

export function normalizeReviewRecord(input: { sourceKey: string; record: ReviewRecord; fetchedAt: string; defaultUrl?: string; sourceCategory: string; providerType: string }): SourceItemCandidate {
  const review = reviewRecordSchema.parse(input.record);
  const externalId = stableReviewExternalId(input.sourceKey, review);
  return sourceItemCandidateSchema.parse({
    sourceKey: input.sourceKey,
    externalId,
    externalConversationId: externalId,
    canonicalUrl: review.canonicalUrl ?? input.defaultUrl,
    authorExternalId: review.authorExternalId,
    authorDisplayName: review.authorDisplayName,
    title: review.title,
    body: review.text,
    publishedAt: review.publishedAt,
    capturedAt: input.fetchedAt,
    language: review.language,
    metadata: {
      ...review.metadata,
      sourceCategory: input.sourceCategory,
      providerType: input.providerType,
      rating: review.rating ?? null,
      verified: review.verified ?? null,
      updatedAt: review.updatedAt ?? null,
    },
    status: "active",
  });
}
