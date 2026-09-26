export const AUTHORIAL_STANCE_VERSION = "authorial_stance_v1" as const;

export type AuthorialStance = "buyer" | "vendor_marketing" | "third_party_technical_discussion" | "unknown";

const VENDOR_PITCH_PATTERNS: readonly RegExp[] = [
  /\b(?:we|i)(?:'ve| have)?\s*(?:just\s+)?(?:built|launched|shipped|released|created|made)\b/i,
  /\bintroducing\b/i,
  /\bshow hn\b/i,
  /\bwe(?:'re| are)\s+excited to\b/i,
  /\bcheck (?:it|us) out\b/i,
  /\bour (?:new )?(?:product|tool|app|startup)\b/i,
];

const BUYER_PATTERNS: readonly RegExp[] = [
  /\bwe(?:'re| are)?\s*(?:looking for|evaluating|switching|migrating|considering)\b/i,
  /\b(?:our|my) team (?:needs?|uses?|is evaluating|switched)\b/i,
  /\bi(?:'m| am)?\s*(?:looking for|evaluating|switching)\b/i,
];

const FIRST_PERSON = /\b(?:i|we|my|our|us)\b/i;

/**
 * Deterministic authorial-stance classification, distinct from speaker_role
 * (buyer/maintainer/unknown): a launch/pitch post about the author's own
 * product is not a buyer expressing switching intent, even when it names a
 * competitor and matches the generic first-person "we/our" regex.
 */
export function classifyAuthorialStance(input: { text: string; hasCompetitorOrAlternativeClaim: boolean }): { stance: AuthorialStance; confidence: number } {
  const value = input.text;
  const isVendorPitch = VENDOR_PITCH_PATTERNS.some((pattern) => pattern.test(value));
  const isBuyer = BUYER_PATTERNS.some((pattern) => pattern.test(value));
  if (isVendorPitch && input.hasCompetitorOrAlternativeClaim && !isBuyer) return { stance: "vendor_marketing", confidence: 0.75 };
  if (isBuyer) return { stance: "buyer", confidence: 0.7 };
  if (!FIRST_PERSON.test(value)) return { stance: "third_party_technical_discussion", confidence: 0.55 };
  return { stance: "unknown", confidence: 0.2 };
}
