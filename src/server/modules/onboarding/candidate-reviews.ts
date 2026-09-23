import type { ConversationRow, SourceItemRow } from "@/server/db/database.helpers";
import { qualificationFromEvidence } from "@/server/modules/intelligence";
import type { IntelligenceService } from "@/server/modules/intelligence/intelligence.service";
import { scanCandidateReviewSchema, type ScanCandidateReview } from "@/server/modules/operations/product-demand-scan.schemas";

function reviewExcerpt(conversation: ConversationRow | undefined, source: SourceItemRow | undefined, fallback: string): string {
  const value = source?.body || conversation?.body || source?.title || conversation?.title || fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, 500) || "No readable excerpt was stored.";
}

export function candidateReviewsFromRows(
  evaluations: Awaited<ReturnType<IntelligenceService["matchProduct"]>>[],
  conversations: ConversationRow[],
  sourceById: Map<string, SourceItemRow>,
): ScanCandidateReview[] {
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  return evaluations.map((evaluation) => {
    const qualification = qualificationFromEvidence(evaluation.evidence);
    if (!qualification || !["qualified", "high_confidence_signal", "weak_candidate", "rejected"].includes(qualification.status)) return null;
    const conversation = conversationById.get(evaluation.conversation_id);
    const source = conversation ? sourceById.get(conversation.primary_source_item_id) : undefined;
    return scanCandidateReviewSchema.parse({
      evaluationId: evaluation.id,
      source: source?.source_key ?? "unknown",
      title: source?.title ?? conversation?.title ?? null,
      excerpt: reviewExcerpt(conversation, source, evaluation.rationale),
      canonicalUrl: source?.canonical_url ?? conversation?.canonical_url ?? null,
      status: qualification.status,
      scores: {
        relevance: qualification.dimensions.product_relevance,
        intent: qualification.dimensions.demand_intent,
        pain: qualification.dimensions.pain_clarity,
        specificity: qualification.dimensions.specificity,
        evidence: qualification.dimensions.evidence_quality,
        noise: qualification.dimensions.noise_risk,
      },
      reasonCodes: qualification.reason_codes,
    });
  }).filter((review): review is ScanCandidateReview => Boolean(review));
}
