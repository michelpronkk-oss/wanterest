import { marketRelationshipTypeSchema } from "./signal-qualification.schemas";

export const SEMANTIC_OUTPUT_NORMALIZATION_VERSION = "semantic_output_normalization_v1" as const;

export type SemanticOutputNormalizationDiagnostics = {
  version: typeof SEMANTIC_OUTPUT_NORMALIZATION_VERSION;
  evidenceSpansTruncated: number;
  evidenceSpansDropped: number;
  relationshipCandidatesDropped: number;
  blockingReason: "unsafe_relationship_candidate" | null;
};

export type SemanticOutputNormalizationResult = {
  value: unknown;
  diagnostics: SemanticOutputNormalizationDiagnostics;
};

function normalizedWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function initialDiagnostics(): SemanticOutputNormalizationDiagnostics {
  return {
    version: SEMANTIC_OUTPUT_NORMALIZATION_VERSION,
    evidenceSpansTruncated: 0,
    evidenceSpansDropped: 0,
    relationshipCandidatesDropped: 0,
    blockingReason: null,
  };
}

function anchoredExcerpt(text: string, sourceText: string): string | null {
  const normalizedSource = normalizedWhitespace(sourceText);
  const normalizedText = normalizedWhitespace(text);
  const start = normalizedSource.indexOf(normalizedText);
  if (start < 0) return null;
  return normalizedSource.slice(start, start + 500);
}

function relationshipCandidateIsSemanticallyRequired(value: Record<string, unknown>): boolean {
  const targetType = value.demand_target_type;
  const direction = value.direction_relative_to_scanned_product;
  return targetType === "third_party_product" || direction === "away_from_product";
}

/**
 * Makes only source-preserving repairs to provider JSON before the canonical
 * conversationMarketReasoningSchema validation. The raw provider value is
 * intentionally not modified by this function and remains available to the
 * existing immutable shadow audit row.
 */
export function normalizeSemanticReasoningOutput(input: { value: unknown; sourceText: string }): SemanticOutputNormalizationResult {
  const diagnostics = initialDiagnostics();
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) return { value: input.value, diagnostics };

  const value = input.value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...value };

  if (Array.isArray(value.evidence_spans)) {
    normalized.evidence_spans = value.evidence_spans.flatMap((span) => {
      if (!span || typeof span !== "object" || Array.isArray(span)) return [span];
      const record = span as Record<string, unknown>;
      if (typeof record.text !== "string" || record.text.length <= 500) return [span];
      const excerpt = anchoredExcerpt(record.text, input.sourceText);
      if (!excerpt) {
        diagnostics.evidenceSpansDropped += 1;
        return [];
      }
      diagnostics.evidenceSpansTruncated += 1;
      return [{ ...record, text: excerpt }];
    });
  }

  if (Array.isArray(value.relationship_candidates)) {
    const candidates = value.relationship_candidates;
    const invalidCandidates = candidates.filter((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return true;
      return !marketRelationshipTypeSchema.safeParse((candidate as Record<string, unknown>).relationship_type).success;
    });
    diagnostics.relationshipCandidatesDropped = invalidCandidates.length;
    normalized.relationship_candidates = candidates.filter((candidate) => !invalidCandidates.includes(candidate));
    if (invalidCandidates.length > 0 && invalidCandidates.length === candidates.length && relationshipCandidateIsSemanticallyRequired(value)) {
      diagnostics.blockingReason = "unsafe_relationship_candidate";
    }
  }

  return { value: normalized, diagnostics };
}
