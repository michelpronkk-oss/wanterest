import type { SignalReadModel } from "@/server/modules/intelligence";

export type SignalCardSignal = Pick<SignalReadModel, "excerpt" | "whyItMatters" | "intentType" | "tags" | "buyerLanguage" | "painThemes" | "qualification">;

export type SignalCardPresentation = {
  summary: string;
  why: string;
  evidence: string;
  tags: string[];
};

const INTERNAL_COPY = /qualified because|high-confidence demand|candidate is|clears? (?:the )?(?:explicit )?(?:demand|evidence) gates?|commercially relevant|normal signal/i;

function cleanText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bounded(value: string, max: number): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return `${cut || text.slice(0, max - 1).trim()}…`;
}

function humanizeConcept(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function firstContentLine(value: string): string {
  return cleanText(value).split(/\n+/u).map((line) => line.trim()).find(Boolean) ?? "Untitled signal";
}

function fallbackIntent(signal: SignalCardSignal): string {
  return signal.intentType.replaceAll("_", " ");
}

function userFacingWhy(signal: SignalCardSignal): string {
  const qualification = signal.qualification;
  const intent = qualification?.primary_intent ?? signal.intentType;
  const concept = humanizeConcept(qualification?.matched_profile_concepts[0]);
  const pain = cleanText(signal.painThemes[0] ?? "");
  const subject = concept ? ` related to ${concept}` : "";
  const suffix = pain && !pain.toLowerCase().includes(concept.toLowerCase()) ? ` after citing ${pain}` : "";

  if (qualification?.intent_target === "authentication" || qualification?.intent_target === "implementation") {
    return bounded(`Technical implementation request${subject}${pain ? ` about ${pain}` : ""}.`, 140);
  }
  if (intent === "switching_intent") return bounded(`Team is evaluating a replacement${subject}${suffix}.`, 140);
  if (intent === "alternative_search") return bounded(`Buyer is looking for an alternative${subject}${suffix}.`, 140);
  if (intent === "recommendation_request") return bounded(`Buyer is asking which solution best fits the need${subject}.`, 140);
  if (intent === "purchase_research" || intent === "vendor_evaluation") return bounded(`Buyer is actively researching a solution${subject}.`, 140);
  if (intent === "comparison_intent") return bounded(`Buyer is comparing solutions${subject}.`, 140);
  if (intent === "feature_requirement") return bounded(`Team needs a specific capability${subject}.`, 140);
  if (intent === "explicit_pain" || intent === "problem_solution_search") return bounded(`Team is describing a concrete workflow problem${subject}.`, 140);

  const source = cleanText(signal.whyItMatters);
  return bounded(INTERNAL_COPY.test(source) ? `Conversation shows ${fallbackIntent(signal)}${subject}.` : source || `Conversation shows ${fallbackIntent(signal)}.`, 140);
}

export function formatSignalCard(signal: SignalCardSignal): SignalCardPresentation {
  const summary = bounded(firstContentLine(signal.excerpt), 110);
  const evidenceCandidate = signal.qualification?.evidence_spans[0]?.text || signal.excerpt;
  const evidence = bounded(evidenceCandidate, 180);
  return {
    summary,
    why: userFacingWhy(signal),
    evidence: evidence && evidence !== summary ? evidence : "",
    tags: signal.tags.length > 0 ? signal.tags.slice(0, 3) : (signal.qualification?.matched_profile_concepts.slice(0, 3) ?? []),
  };
}
