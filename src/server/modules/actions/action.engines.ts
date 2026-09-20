import { sha256Json } from "../ingestion/hash";
import { actionGenerationInputSchema, businessHypothesisSchema, clampAction, type ActionGenerationInput, type ActionType, type BusinessHypothesis, parseVariantContent } from "./action.schemas";

export const ACTION_PRIORITY_FORMULA_VERSION = "action-priority-v1";

export type ActionPriorityInputs = Pick<ActionGenerationInput,
  "evidenceStrength" | "marketWeight" | "gapScore" | "driftStrength" |
  "intentStrength" | "opportunityScore" | "confidence" | "freshness"
>;

export function calculateActionPriority(input: ActionPriorityInputs): number {
  const opportunity = Math.max(input.gapScore, input.driftStrength, input.opportunityScore);
  return clampAction(
    input.evidenceStrength * 0.2 +
    input.marketWeight * 0.15 +
    opportunity * 0.2 +
    input.intentStrength * 0.15 +
    input.confidence * 0.15 +
    input.freshness * 0.1 +
    Math.max(input.gapScore, input.driftStrength) * 0.05,
  );
}

export function actionCandidateIsQualified(input: ActionGenerationInput): boolean {
  if (input.sampleQuality === "insufficient_data" || input.sampleSize < 5) return false;
  if (input.triggerType === "demand_gap") {
    return input.gapScore >= 0.35 && input.marketWeight >= 0.15 && input.positioningWeight <= 0.75;
  }
  if (input.triggerType === "demand_drift") {
    return input.driftDirection === "rising" && (input.driftSignificance === "notable" || input.driftSignificance === "strong") && input.driftStrength >= 0.2;
  }
  if (input.triggerType === "signal") {
    return input.opportunityScore >= 0.7 && input.confidence >= 0.65 && input.specificity >= 0.55;
  }
  return input.marketWeight >= 0.25 && input.evidenceStrength >= 0.6;
}

export type DemandActionResult = {
  actionType: ActionType;
  targetKey: string;
  title: string;
  summary: string;
  suggestedChange: string;
  currentState: string | null;
  targetMetric: string;
  businessHypothesis: BusinessHypothesis;
  confidence: number;
  priorityScore: number;
  why: string;
  inputFingerprint: string;
};

export interface DemandActionEngine {
  readonly version: string;
  generate(input: ActionGenerationInput): Promise<DemandActionResult[]>;
}

function targetFor(input: ActionGenerationInput): string {
  if (input.targetKey !== "auto") return input.targetKey;
  if (input.triggerType === "demand_drift") return "new_landing_page";
  if (input.triggerType === "signal") return "product_research";
  return "homepage_hero";
}

function typeFor(input: ActionGenerationInput): ActionType {
  if (input.triggerType === "demand_drift") return "landing_page";
  if (input.triggerType === "signal") return "product_research";
  return "messaging_change";
}

export class FixtureDemandActionEngine implements DemandActionEngine {
  readonly version = "fixture-action-v1";

  async generate(rawInput: ActionGenerationInput): Promise<DemandActionResult[]> {
    const input = actionGenerationInputSchema.parse(rawInput);
    if (!actionCandidateIsQualified(input)) return [];

    const actionType = typeFor(input);
    const targetKey = targetFor(input);
    const priorityScore = calculateActionPriority(input);
    const triggerLabel = input.conceptLabel.trim();
    const observation = input.triggerType === "demand_drift"
      ? `${triggerLabel} is showing a notable upward change in observed demand.`
      : input.triggerType === "signal"
        ? `A high-fit signal specifically mentions ${triggerLabel}.`
        : `${triggerLabel} has meaningful observed demand while current positioning is limited.`;
    const target = targetKey === "homepage_hero" ? "homepage hero" : targetKey.replace(/_/g, " ");
    const metric = input.triggerType === "signal" ? "research qualification and action usefulness" : "CTA click or signup conversion later";
    const hypothesis = businessHypothesisSchema.parse({
      observation,
      hypothesis: `Making ${triggerLabel} more explicit may better match observed demand; this is worth testing, not a guaranteed outcome.`,
      target,
      metric,
    });
    const title = input.triggerType === "demand_drift"
      ? `Create a ${triggerLabel} landing page`
      : input.triggerType === "signal"
        ? `Research the ${triggerLabel} capability gap`
        : `Update the ${target} for ${triggerLabel}`;
    const summary = input.triggerType === "demand_drift"
      ? `${triggerLabel} is rising enough to justify a focused landing-page hypothesis.`
      : `Observed evidence suggests the product could speak more directly to ${triggerLabel}.`;
    const suggestedChange = input.triggerType === "demand_drift"
      ? `Create a landing page explaining how ${input.productName} addresses ${triggerLabel}.`
      : input.triggerType === "signal"
        ? `Investigate the missing capability and validate it with additional buyer conversations.`
        : `Lead with the buyer pain around ${triggerLabel} and connect it to the product's current capability.`;
    const result = {
      actionType,
      targetKey,
      title,
      summary,
      suggestedChange,
      currentState: input.positioningWeight > 0 ? `Current positioning coverage is approximately ${Math.round(input.positioningWeight * 100)}%.` : null,
      targetMetric: metric,
      businessHypothesis: hypothesis,
      confidence: clampAction(Math.min(input.confidence, input.evidenceStrength || input.confidence)),
      priorityScore,
      why: `${triggerLabel} is supported by product-specific evidence with a ${Math.round(input.confidence * 100)}% confidence estimate.`,
      inputFingerprint: sha256Json({ input, engine: this.version, priorityFormula: ACTION_PRIORITY_FORMULA_VERSION }),
    } satisfies DemandActionResult;
    return [result];
  }
}

export type DemandActionVariantResult = {
  variantKey: string;
  label: string;
  content: Record<string, unknown>;
  rationale: string;
  inputFingerprint: string;
};

export interface DemandActionVariantEngine {
  readonly version: string;
  generate(input: { action: DemandActionResult; actionId: string; productName: string }): Promise<DemandActionVariantResult[]>;
}

export class FixtureDemandActionVariantEngine implements DemandActionVariantEngine {
  readonly version = "fixture-action-variant-v1";

  async generate(input: { action: DemandActionResult; actionId: string; productName: string }): Promise<DemandActionVariantResult[]> {
    const actionType = input.action.actionType;
    const values: Array<{ variantKey: string; label: string; content: Record<string, unknown>; rationale: string }> = actionType === "messaging_change"
      ? [
          { variantKey: "variant_a", label: "Pain-led", content: { headline: "Stop important work from falling through the cracks.", subheadline: "Keep the workflow moving when manual handoffs start to slow the team down.", cta: "See how it works" }, rationale: "Leads with the observed pain theme." },
          { variantKey: "variant_b", label: "Capability-led", content: { headline: "Keep your inbox and CRM working as one.", subheadline: "Make the next step visible without copying work between tools.", cta: "Explore the workflow" }, rationale: "Connects the observed pain to the requested capability." },
        ]
      : actionType === "landing_page"
        ? [
            { variantKey: "variant_a", label: "Outcome angle", content: { angle: "One connected workflow", headline: `Connect ${input.productName} to the work that needs follow-through.`, problemStatement: "Important context gets lost when the inbox and CRM drift apart.", proofPoints: ["Clearer handoffs", "Less repeated entry"], cta: "Explore the workflow" }, rationale: "Frames the rising demand as an outcome." },
            { variantKey: "variant_b", label: "Pain angle", content: { angle: "Falling-through-cracks pain", headline: "Keep customer work from disappearing between tools.", problemStatement: "Manual follow-up creates gaps that are hard to see until they cost time.", proofPoints: ["Visible next steps", "Fewer manual checks"], cta: "See the approach" }, rationale: "Uses the specific observed pain language." },
          ]
        : [{ variantKey: "variant_a", label: "Primary hypothesis", content: { angle: input.action.suggestedChange, audience: "High-intent buyers represented by the source evidence.", proof: [input.action.why] }, rationale: "Keeps the hypothesis tied to the validated evidence." }];
    return values.map((value) => ({ ...value, inputFingerprint: sha256Json({ actionId: input.actionId, action: input.action.inputFingerprint, engine: this.version, variantKey: value.variantKey }) }));
  }

  validate(actionType: ActionType, content: unknown): Record<string, unknown> {
    return parseVariantContent(actionType, content);
  }
}
