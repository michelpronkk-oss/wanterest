import { X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION } from "../../providers/source/x/x.query";

export const xCompetitorEvidenceMismatchReason = "x_competitor_evidence_mismatch" as const;
export const xCompetitorMissingCompilerProvenanceReason = "missing_compiler_provenance" as const;

export type XCompetitorPainRetrievalProvenance = {
  templateVersion: typeof X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION;
  competitor: string;
  displacementAnchors: string[];
};

export type XCompetitorEvidenceAlignmentMismatch = {
  conversationId: string;
  queryPlanId: string;
  competitor: string;
  displacementMatches: string[];
  competitorMatched: boolean;
  reason: typeof xCompetitorEvidenceMismatchReason;
};

export type XCompetitorEvidenceAlignmentDiagnostics = {
  inspectedCount: number;
  alignedCount: number;
  mismatchCount: number;
  provenanceMissingCount: number;
  provenanceMissingReason?: typeof xCompetitorMissingCompilerProvenanceReason;
  mismatches: XCompetitorEvidenceAlignmentMismatch[];
};

export type XCompetitorEvidenceAlignmentResult =
  | { aligned: true; provenanceMissing: false; mismatches: [] }
  | { aligned: false; provenanceMissing: true; mismatches: [] }
  | { aligned: false; provenanceMissing: false; mismatches: XCompetitorEvidenceAlignmentMismatch[] };

function normalizeEvidenceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseMatches(text: string, phrase: string): boolean {
  const normalized = normalizeEvidenceText(phrase);
  if (!normalized) return false;
  const pattern = normalized.split(" ").map(escaped).join("\\s+");
  return new RegExp(`(?:^|\\b)${pattern}(?:\\b|$)`, "i").test(text);
}

export function xCompetitorPainCompilationFromMetadata(metadata: Record<string, unknown>): XCompetitorPainRetrievalProvenance | null {
  if (metadata.queryFamily !== "comparison") return null;
  const competitor = typeof metadata.xCompetitorPainCompetitor === "string" ? metadata.xCompetitorPainCompetitor.replace(/\s+/g, " ").trim() : "";
  const rawAnchors = metadata.xCompetitorPainDisplacementAnchors;
  if (!competitor || !Array.isArray(rawAnchors) || !rawAnchors.length) return null;
  const displacementAnchors = rawAnchors.map((value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  if (displacementAnchors.some((value) => !value)) return null;
  return { templateVersion: X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION, competitor, displacementAnchors };
}

export function alignXCompetitorPainEvidence(input: {
  conversationId: string;
  text: string;
  queries: Array<{ queryPlanId: string; xCompetitorPainRetrievalV1?: XCompetitorPainRetrievalProvenance }>;
}): XCompetitorEvidenceAlignmentResult | null {
  if (!input.queries.length) return null;
  const normalizedText = normalizeEvidenceText(input.text);
  const missingProvenance = input.queries.some((query) => {
    const provenance = query.xCompetitorPainRetrievalV1;
    return !provenance
      || provenance.templateVersion !== X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION
      || !provenance.competitor.trim()
      || !provenance.displacementAnchors.length
      || provenance.displacementAnchors.some((anchor) => !anchor.trim());
  });
  if (missingProvenance) return { aligned: false, provenanceMissing: true, mismatches: [] };

  const mismatches = input.queries.map((query) => {
    const provenance = query.xCompetitorPainRetrievalV1!;
    const displacementMatches = [...new Set(provenance.displacementAnchors.filter((anchor) => phraseMatches(normalizedText, anchor)))].sort();
    const competitorMatched = phraseMatches(normalizedText, provenance.competitor);
    return { conversationId: input.conversationId, queryPlanId: query.queryPlanId, competitor: provenance.competitor, displacementMatches, competitorMatched, reason: xCompetitorEvidenceMismatchReason };
  }).filter((mismatch) => !mismatch.displacementMatches.length || !mismatch.competitorMatched);
  return mismatches.length ? { aligned: false, provenanceMissing: false, mismatches } : { aligned: true, provenanceMissing: false, mismatches: [] };
}

export function emptyXCompetitorEvidenceAlignmentDiagnostics(): XCompetitorEvidenceAlignmentDiagnostics {
  return { inspectedCount: 0, alignedCount: 0, mismatchCount: 0, provenanceMissingCount: 0, mismatches: [] };
}
