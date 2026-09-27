import { describe, expect, it } from "vitest";

import { toStructuredJsonSchema } from "../../src/server/providers/llm/json-schema";
import { conversationMarketReasoningSchema, type ConversationMarketReasoning } from "../../src/server/modules/intelligence/signal-qualification.schemas";
import { normalizeSemanticReasoningOutput } from "../../src/server/modules/intelligence/semantic-output-normalizer";
import { validateShadowReasoningEvidence } from "../../src/server/modules/intelligence/semantic-reasoning-router";

const sourceText = "We are switching from Jira to Linear because Jira is too slow.";

function reasoning(overrides: Partial<ConversationMarketReasoning> = {}): ConversationMarketReasoning {
  return {
    version: "conversation_market_reasoning_v1", actor_type: "buyer", actor_confidence: 0.8,
    buyer_context: true, buyer_context_confidence: 0.8, current_solution: "Jira", pain_summary: "Jira is too slow",
    requested_outcome: null, demand_target_type: "scanned_product", demand_target: "Linear", source_products: ["Jira"], destination_products: ["Linear"],
    mentioned_products: [{ name: "Jira", role: "source", confidence: 0.9 }, { name: "Linear", role: "destination", confidence: 0.9 }],
    direction_relative_to_scanned_product: "toward_product", category_or_job_demand: false, commercial_intent: true,
    first_party_experience: true, implementation_only: false, promotional_content: false, confidence: 0.7,
    evidence_spans: [{ text: sourceText, confidence: 0.9 }], short_user_facing_summary: "Moving from Jira to Linear.",
    short_user_facing_why: "The author reports Jira is too slow.", relationship_candidates: [], authorial_stance: "buyer", ...overrides,
  };
}

function schemaNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(schemaNodes);
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(schemaNodes)];
}

describe("semantic output normalization", () => {
  it("keeps provider-facing constraints present while retaining application validation", () => {
    const nodes = schemaNodes(toStructuredJsonSchema(conversationMarketReasoningSchema));
    expect(nodes.some((node) => node.maxLength === 500)).toBe(true);
    expect(nodes.some((node) => Array.isArray(node.enum) && node.enum.includes("legacy_manual_substitute"))).toBe(true);
  });

  it("leaves 499- and 500-character evidence spans unchanged", () => {
    for (const length of [499, 500]) {
      const text = "x".repeat(length);
      const input = reasoning({ evidence_spans: [{ text, confidence: 0.9 }] });
      const result = normalizeSemanticReasoningOutput({ value: input, sourceText: text });
      expect(result.value).toEqual(input);
      expect(conversationMarketReasoningSchema.safeParse(result.value).success).toBe(true);
      expect(result.diagnostics.evidenceSpansTruncated).toBe(0);
    }
  });

  it("uses only a literal source-anchored 500-character excerpt for an overlong span", () => {
    const source = "source segment ".repeat(60);
    const span = source.slice(10, 611);
    const result = normalizeSemanticReasoningOutput({ value: reasoning({ evidence_spans: [{ text: span, confidence: 0.9 }] }), sourceText: source });
    const normalized = (result.value as ConversationMarketReasoning).evidence_spans[0]?.text;
    const normalizedSource = source.replace(/\s+/g, " ").trim();
    const normalizedSpan = span.replace(/\s+/g, " ").trim();
    expect(normalized).toBe(normalizedSource.slice(normalizedSource.indexOf(normalizedSpan), normalizedSource.indexOf(normalizedSpan) + 500));
    expect(normalized?.length).toBe(500);
    expect(normalized).not.toContain("...");
    expect(result.diagnostics.evidenceSpansTruncated).toBe(1);
    expect(conversationMarketReasoningSchema.safeParse(result.value).success).toBe(true);
  });

  it("drops an overlong non-source span and fails closed when no evidence remains", () => {
    const result = normalizeSemanticReasoningOutput({ value: reasoning({ evidence_spans: [{ text: "not in the supplied source ".repeat(30), confidence: 0.9 }] }), sourceText });
    expect((result.value as ConversationMarketReasoning).evidence_spans).toEqual([]);
    expect(result.diagnostics.evidenceSpansDropped).toBe(1);
    const parsed = conversationMarketReasoningSchema.safeParse(result.value);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(validateShadowReasoningEvidence({ reasoning: parsed.data, sourceText }).reasoning).toBeNull();
  });

  it("drops an invalid relationship candidate while preserving valid candidates", () => {
    const result = normalizeSemanticReasoningOutput({
      value: reasoning({ relationship_candidates: [
        { entity_name: "Jira", relationship_type: "direct_competitor", confidence: 0.9, evidence_count: 1 },
        { entity_name: "Unknown", relationship_type: "technical_alternative", confidence: 0.9, evidence_count: 1 } as never,
      ] }),
      sourceText,
    });
    expect((result.value as ConversationMarketReasoning).relationship_candidates).toEqual([{ entity_name: "Jira", relationship_type: "direct_competitor", confidence: 0.9, evidence_count: 1 }]);
    expect(result.diagnostics.relationshipCandidatesDropped).toBe(1);
    expect(conversationMarketReasoningSchema.safeParse(result.value).success).toBe(true);
  });

  it("fails closed rather than mapping a sole required invalid relationship", () => {
    const result = normalizeSemanticReasoningOutput({
      value: reasoning({ demand_target_type: "third_party_product", relationship_candidates: [
        { entity_name: "Unknown", relationship_type: "technical_alternative", confidence: 0.9, evidence_count: 1 } as never,
      ] }),
      sourceText,
    });
    expect(result.diagnostics.blockingReason).toBe("unsafe_relationship_candidate");
    expect((result.value as ConversationMarketReasoning).relationship_candidates).toEqual([]);
    expect(conversationMarketReasoningSchema.safeParse(result.value).success).toBe(true);
  });

  it("covers the production-derived 89 and 024 failure shapes without broadening the canonical schema", () => {
    const source89 = "JIRA Alternatives for Websphere " + "source evidence ".repeat(60);
    const normalized89 = normalizeSemanticReasoningOutput({ value: reasoning({ evidence_spans: [{ text: source89, confidence: 0.9 }] }), sourceText: source89 });
    expect(conversationMarketReasoningSchema.safeParse(normalized89.value).success).toBe(true);
    expect(normalized89.diagnostics.evidenceSpansTruncated).toBe(1);

    const normalized024 = normalizeSemanticReasoningOutput({ value: reasoning({ relationship_candidates: [{ entity_name: "Jira", relationship_type: "technical_alternative", confidence: 0.9, evidence_count: 1 } as never] }), sourceText });
    expect((normalized024.value as ConversationMarketReasoning).relationship_candidates).toEqual([]);
    expect(conversationMarketReasoningSchema.safeParse(normalized024.value).success).toBe(true);
    expect(normalized024.diagnostics.relationshipCandidatesDropped).toBe(1);
  });
});
