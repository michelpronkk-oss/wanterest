import type { IntentType } from "./intelligence.schemas";

export type IntentTarget = "product" | "authentication" | "implementation" | "unknown";

const AUTHENTICATION_TERMS = /\b(?:oauth|authentication|auth|api tokens?|access tokens?|credentials?|login|sign[- ]?in)\b/i;
const IMPLEMENTATION_TERMS = /\b(?:integration|implementation|tooling|sdk|api|webhook|parser|endpoint|library|adapter|connector|label operations?)\b/i;
const IMPLEMENTATION_ACTIONS = /\b(?:alternative|switch(?:ing|ed)?|replac(?:e|ing|ed)|change|migrat(?:e|ing|ed)|refactor(?:ing)?|rewrite|add|build(?:ing)?|implement(?:ation|ing)?|support|need|want|looking for)\b/i;

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Identifies the object of a demand phrase before broad intent keywords are interpreted. */
export function detectIntentTarget(value: string): IntentTarget {
  const text = normalized(value);
  const productFeatureRequest = /\b(?:need|want|looking for)\s+(?:a|an|the|another|new|better|simpler)\s+[^.!?]{0,100}\b(?:with|that supports?|including)\b/i;
  if (productFeatureRequest.test(text) && !/\b(?:alternative|switch(?:ing|ed)?|replac(?:e|ing|ed)|migrat(?:e|ing|ed)|refactor(?:ing)?|rewrite)\b/i.test(text)) return "product";
  if (AUTHENTICATION_TERMS.test(text)) return "authentication";
  if (IMPLEMENTATION_TERMS.test(text) && IMPLEMENTATION_ACTIONS.test(text)) return "implementation";
  if (/\b(?:alternative(?:s)?\s+to|switch(?:ing|ed)?\s+(?:away\s+from|from)|replac(?:e|ing|ed)\s+\S+|move\s+away\s+from|leav(?:e|ing)\s+\S+)\b/i.test(text)) return "product";
  return "unknown";
}

/** Implementation/authentication work is not product switching or alternative-product search. */
export function classifyConversationIntent(value: string, fallback?: IntentType): IntentType {
  const text = normalized(value);
  const target = detectIntentTarget(text);
  if (target === "authentication" || target === "implementation") return "problem_signal";
  if (/\b(?:switch(?:ing|ed)?|replac(?:e|ing|ed)|leaving|migrat(?:e|ing|ed)|move away|stopped using|renew(?:al|ing))\b/i.test(text)) return "switching_intent";
  if (/\balternative(?:s)?\b|\binstead of\b|\bwhat else\b|\bother options?\b/i.test(text)) return "alternative_search";
  if (/\b(?:best|recommend|recommendation)\b|\bdoes anyone know\b|\bwhat should i use\b|\blooking for\b/i.test(text)) return "alternative_search";
  if (/\b(?:need|looking for|buy|pricing|how can i solve|any tool)\b/i.test(text)) return "high_intent";
  if (/\b(?:pain|problem|frustrat|hard to|struggl|wish there was|slow|manual)\b/i.test(text)) return "problem_signal";
  return fallback ?? "informational";
}
