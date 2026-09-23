import { sha256Text } from "../ingestion/hash";
import { conversationAnalysisSchema, demandProfileSchema, productMatchResultSchema, type ConversationAnalysisResult, type DemandProfileResult, type ProductMatchResult } from "./intelligence.schemas";
import type { ConversationRow, ProductSnapshotRow, DemandProfileRow } from "../../db/database.helpers";
import { classifyConversationIntent } from "./intent-semantics";

export type DemandProfileInput = { snapshots: ProductSnapshotRow[]; productName: string };
export type ConversationAnalysisInput = { conversation: ConversationRow; sourceItemId: string };
export type ProductMatchingInput = { profile: DemandProfileRow; analysis: ConversationAnalysisResult; productName: string; conversation: ConversationRow };

export interface DemandProfileEngine {
  readonly engineType: "profile";
  readonly version: string;
  generate(input: DemandProfileInput): Promise<DemandProfileResult>;
}
export interface ConversationAnalysisEngine {
  readonly engineType: "classifier";
  readonly version: string;
  analyze(input: ConversationAnalysisInput): Promise<ConversationAnalysisResult>;
}
export interface ProductMatchingEngine {
  readonly engineType: "matcher";
  readonly version: string;
  match(input: ProductMatchingInput): Promise<ProductMatchResult>;
}

function words(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])].slice(0, 30);
}

export class FixtureDemandProfileEngine implements DemandProfileEngine {
  readonly engineType = "profile" as const;
  readonly version = "fixture-profile-v1";
  async generate(input: DemandProfileInput): Promise<DemandProfileResult> {
    const text = input.snapshots.map((snapshot) => snapshot.normalized_text).join(" ");
    const tokens = words(text);
    const result = demandProfileSchema.parse({
      audience: tokens.filter((token) => ["developer", "founder", "team", "marketer", "designer", "business"].includes(token)).slice(0, 6),
      jobs: tokens.slice(0, 8).map((token) => `manage ${token}`),
      problems: tokens.slice(1, 9).map((token) => `${token} is difficult`),
      desiredOutcomes: tokens.slice(0, 6).map((token) => `better ${token}`),
      capabilities: tokens.slice(0, 10),
      alternatives: [],
      includeTerms: tokens.slice(0, 20),
      excludeTerms: [],
      languages: ["en"],
      geographies: [],
      confidence: Math.min(0.95, 0.45 + Math.min(tokens.length, 20) / 50),
    });
    return result;
  }
}

export class FixtureConversationAnalysisEngine implements ConversationAnalysisEngine {
  readonly engineType = "classifier" as const;
  readonly version = "fixture-classifier-v2";
  async analyze(input: ConversationAnalysisInput): Promise<ConversationAnalysisResult> {
    const text = `${input.conversation.title ?? ""} ${input.conversation.body}`;
    const lower = text.toLowerCase();
    const tooShort = input.conversation.body.trim().length < 20;
    const intentType = tooShort ? "unknown" : classifyConversationIntent(lower);
    const painThemes = words(text).filter((token) => /slow|manual|hard|pain|problem|cost|workflow|search|deploy|report/.test(token)).slice(0, 8);
    const buyerLanguage = (lower.match(/\b(need|looking for|buy|pricing|recommend|switch|replace|alternative)\b[^.!?]{0,100}/g) ?? []).slice(0, 8);
    const evidenceSpans = [];
    const phrase = intentType === "unknown" ? input.conversation.body.trim().slice(0, 20) : (buyerLanguage[0] ?? input.conversation.body.trim().slice(0, 80));
    const start = Math.max(0, input.conversation.body.toLowerCase().indexOf(phrase.toLowerCase()));
    if (phrase && start >= 0) evidenceSpans.push({ sourceItemId: input.sourceItemId, field: "body" as const, startOffset: start, endOffset: start + phrase.length, excerptHash: sha256Text(phrase), evidenceType: "intent_phrase", confidence: intentType === "unknown" ? 0.35 : 0.82 });
    return conversationAnalysisSchema.parse({
      intentType,
      painThemes,
      desiredOutcomes: intentType === "high_intent" || intentType === "alternative_search" ? ["find a workable solution"] : [],
      alternatives: /alternative|instead of|replace|switch/.test(lower) ? words(text).filter((token) => token.length > 4).slice(0, 4) : [],
      buyerLanguage,
      audienceSignals: /developer|founder|team|agency|marketing/.test(lower) ? ["explicit role signal"] : [],
      specificity: tooShort ? 0.05 : Math.min(0.95, 0.35 + (painThemes.length * 0.08) + (buyerLanguage.length * 0.08)),
      urgency: /urgent|asap|today|this week|blocked/.test(lower) ? 0.85 : null,
      confidence: tooShort ? 0.2 : intentType === "informational" ? 0.55 : 0.82,
      evidenceSpans,
    });
  }
}

export class FixtureProductMatchingEngine implements ProductMatchingEngine {
  readonly engineType = "matcher" as const;
  readonly version = "fixture-matcher-v1";
  async match(input: ProductMatchingInput): Promise<ProductMatchResult> {
    const profileText = [input.profile.include_terms, input.profile.capabilities, input.profile.problems].flatMap((value) => Array.isArray(value) ? value : []).join(" ").toLowerCase();
    const analysisText = [input.analysis.painThemes, input.analysis.desiredOutcomes, input.analysis.alternatives].flat().join(" ").toLowerCase();
    const excludes = Array.isArray(input.profile.exclude_terms) ? input.profile.exclude_terms : [];
    const excluded = excludes.some((term) => analysisText.includes(String(term).toLowerCase()));
    const aligned = (analysisText.match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((token) => profileText.includes(token));
    const painAlignment = aligned.slice(0, 8);
    const confidence = excluded ? 0.05 : Math.min(0.98, 0.25 + painAlignment.length * 0.09 + input.analysis.confidence * 0.35);
    const decision = excluded || input.analysis.intentType === "unknown" && input.analysis.confidence < 0.4 ? "rejected" : confidence >= 0.58 ? "qualified" : confidence >= 0.3 ? "weak" : "rejected";
    return productMatchResultSchema.parse({
      decision,
      matchConfidence: confidence,
      rationale: excluded ? "The conversation contains a profile exclusion." : painAlignment.length ? `The conversation overlaps with ${painAlignment.slice(0, 3).join(", ")}.` : "The conversation has limited evidence of product fit.",
      evidence: {
        painAlignment,
        buyerAlignment: input.analysis.audienceSignals,
        capabilityAlignment: painAlignment,
        intentRelevance: [input.analysis.intentType],
      },
    });
  }
}
