import { z } from "zod";

export const intentTypeSchema = z.enum([
  "high_intent",
  "problem_signal",
  "switching_intent",
  "alternative_search",
  "informational",
  "low_intent",
  "unknown",
]);
export type IntentType = z.infer<typeof intentTypeSchema>;

const boundedStringArray = z.array(z.string().trim().min(1).max(300)).max(100);
export const evidenceSpanSchema = z.object({
  sourceItemId: z.string().uuid().optional(),
  field: z.enum(["title", "body", "author", "metadata"]),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  excerptHash: z.string().regex(/^[0-9a-f]{64}$/),
  evidenceType: z.string().trim().min(1).max(120),
  confidence: z.number().min(0).max(1),
});
export type EvidenceSpan = z.infer<typeof evidenceSpanSchema>;

export const demandProfileSchema = z.object({
  audience: boundedStringArray,
  jobs: boundedStringArray,
  problems: boundedStringArray,
  desiredOutcomes: boundedStringArray,
  capabilities: boundedStringArray,
  alternatives: boundedStringArray,
  includeTerms: boundedStringArray,
  excludeTerms: boundedStringArray,
  languages: z.array(z.string().trim().min(2).max(32)).max(30),
  geographies: boundedStringArray,
  confidence: z.number().min(0).max(1),
});
export type DemandProfileResult = z.infer<typeof demandProfileSchema>;

export const conversationAnalysisSchema = z.object({
  intentType: intentTypeSchema,
  painThemes: boundedStringArray,
  desiredOutcomes: boundedStringArray,
  alternatives: boundedStringArray,
  buyerLanguage: boundedStringArray,
  audienceSignals: boundedStringArray,
  specificity: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceSpans: z.array(evidenceSpanSchema).max(100),
});
export type ConversationAnalysisResult = z.infer<typeof conversationAnalysisSchema>;

export const matchingEvidenceSchema = z.object({
  painAlignment: z.array(z.string()).max(50),
  buyerAlignment: z.array(z.string()).max(50),
  capabilityAlignment: z.array(z.string()).max(50),
  intentRelevance: z.array(z.string()).max(50),
});

export const productMatchResultSchema = z.object({
  decision: z.enum(["qualified", "weak", "rejected"]),
  matchConfidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(5_000),
  evidence: matchingEvidenceSchema,
});
export type ProductMatchResult = z.infer<typeof productMatchResultSchema>;

export const feedbackTypeSchema = z.enum(["opened", "saved", "dismissed", "relevant", "not_relevant", "contacted", "converted"]);
export type FeedbackType = z.infer<typeof feedbackTypeSchema>;
