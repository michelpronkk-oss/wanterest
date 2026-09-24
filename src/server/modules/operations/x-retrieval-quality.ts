import { X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION } from "../../providers/source/x/x.query";

export const xCompetitorEvidenceMismatchReason = "x_competitor_evidence_mismatch" as const;
export const xCompetitorMissingCompilerProvenanceReason = "missing_compiler_provenance" as const;
export const xCompetitorDisplacementNotBoundSubreason = "competitor_displacement_not_bound" as const;

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
  subreason: typeof xCompetitorDisplacementNotBoundSubreason;
};

export type XCompetitorBoundMatch = {
  anchor: string;
  competitor: string;
  matchedText: string;
};

export type XCompetitorEvidenceAlignmentDiagnostics = {
  inspectedCount: number;
  alignedCount: number;
  mismatchCount: number;
  provenanceMissingCount: number;
  provenanceMissingReason?: typeof xCompetitorMissingCompilerProvenanceReason;
  bindingMatched: boolean;
  boundMatches: XCompetitorBoundMatch[];
  mismatches: XCompetitorEvidenceAlignmentMismatch[];
};

export type XCompetitorEvidenceAlignmentResult =
  | { aligned: true; provenanceMissing: false; bindingMatched: true; boundMatches: XCompetitorBoundMatch[]; mismatches: [] }
  | { aligned: false; provenanceMissing: true; bindingMatched: false; boundMatches: []; mismatches: [] }
  | { aligned: false; provenanceMissing: false; bindingMatched: false; boundMatches: []; mismatches: XCompetitorEvidenceAlignmentMismatch[] };

function normalizeEvidenceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceSegments(value: string, anchors: string[]): string[] {
  const anchorSpans = anchors
    .map((anchor) => normalizeEvidenceText(anchor).split(" ").filter(Boolean).map(escaped).join("\\s+"))
    .filter(Boolean);
  const newlineSafeValue = anchorSpans.reduce((current, anchorPattern) => current.replace(new RegExp(anchorPattern, "gi"), (match) => match.replace(/\s+/g, " ")), value ?? "");
  return newlineSafeValue
    .split(/[.!?\n;\u2014\u2013]+/u)
    .map((segment) => segment.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

function phraseMatches(text: string, phrase: string): boolean {
  const normalized = normalizeEvidenceText(phrase);
  if (!normalized) return false;
  const pattern = normalized.split(" ").map(escaped).join("\\s+");
  return new RegExp(`(?:^|\\b)${pattern}(?:\\b|$)`, "i").test(text);
}

function boundMatchesInSegment(segment: string, anchor: string, competitor: string): XCompetitorBoundMatch[] {
  const anchorTokens = normalizeEvidenceText(anchor).split(" ").filter(Boolean);
  const competitorTokens = normalizeEvidenceText(competitor).split(" ").filter(Boolean);
  if (!anchorTokens.length || !competitorTokens.length) return [];
  const anchorPattern = anchorTokens.map(escaped).join("\\s+");
  const competitorPattern = competitorTokens.map(escaped).join("\\s+");
  const optionalObjectWords = anchor === "replace" || anchor === "replacing"
    ? "(?:(?:the|our|a|an|my|current|existing|old|new|this)\\s+){0,2}"
    : "(?:(?:the|our|a|an|my|current|existing|old|new|this)\\s+){0,1}";
  const pattern = new RegExp(`(?:^|\\b)${anchorPattern}\\s+${optionalObjectWords}${competitorPattern}(?=$|\\b)`, "i");
  const match = pattern.exec(segment);
  if (!match) return [];
  return [{ anchor: normalizeEvidenceText(anchor), competitor: normalizeEvidenceText(competitor), matchedText: match[0].trim() }];
}

function boundMatchesFor(text: string, anchors: string[], competitor: string): XCompetitorBoundMatch[] {
  const matches: XCompetitorBoundMatch[] = [];
  for (const segment of sentenceSegments(text, anchors)) {
    for (const anchor of anchors) matches.push(...boundMatchesInSegment(segment, anchor, competitor));
  }
  return [...new Map(matches.map((match) => [`${match.anchor}:${match.competitor}:${match.matchedText}`, match])).values()];
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
  if (missingProvenance) return { aligned: false, provenanceMissing: true, bindingMatched: false, boundMatches: [], mismatches: [] };

  const evaluations = input.queries.map((query) => {
    const provenance = query.xCompetitorPainRetrievalV1!;
    const displacementMatches = [...new Set(provenance.displacementAnchors.filter((anchor) => phraseMatches(normalizedText, anchor)))].sort();
    const competitorMatched = phraseMatches(normalizedText, provenance.competitor);
    const boundMatches = boundMatchesFor(input.text, provenance.displacementAnchors, provenance.competitor);
    return { query, displacementMatches, competitorMatched, boundMatches };
  });
  const boundMatches = [...new Map(evaluations.flatMap((evaluation) => evaluation.boundMatches).map((match) => [`${match.anchor}:${match.competitor}:${match.matchedText}`, match])).values()];
  if (boundMatches.length) return { aligned: true, provenanceMissing: false, bindingMatched: true, boundMatches, mismatches: [] };
  const mismatches = evaluations.map(({ query, displacementMatches, competitorMatched }) => {
    const provenance = query.xCompetitorPainRetrievalV1!;
    return { conversationId: input.conversationId, queryPlanId: query.queryPlanId, competitor: provenance.competitor, displacementMatches, competitorMatched, reason: xCompetitorEvidenceMismatchReason, subreason: xCompetitorDisplacementNotBoundSubreason };
  });
  return { aligned: false, provenanceMissing: false, bindingMatched: false, boundMatches: [], mismatches };
}

export function emptyXCompetitorEvidenceAlignmentDiagnostics(): XCompetitorEvidenceAlignmentDiagnostics {
  return { inspectedCount: 0, alignedCount: 0, mismatchCount: 0, provenanceMissingCount: 0, bindingMatched: false, boundMatches: [], mismatches: [] };
}
