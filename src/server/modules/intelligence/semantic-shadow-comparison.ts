import type { SignalQualification } from "./signal-qualification.schemas";

export const SHADOW_IMPACT_TYPES = ["no_change", "would_strengthen", "would_weaken", "would_become_qualified", "would_become_unqualified", "would_change_direction", "would_change_target"] as const;
export type ShadowImpact = typeof SHADOW_IMPACT_TYPES[number];

export type SemanticShadowComparison = {
  actual: SignalQualification;
  shadow: SignalQualification;
  impact: ShadowImpact[];
};

/** Failed, skipped, and incomplete artifacts are deliberately not comparable. */
export function canCompareSemanticShadowArtifact(artifact: Record<string, unknown>): boolean {
  return artifact.execution_status === "success" && artifact.merged_shadow_reasoning !== null && artifact.merged_shadow_reasoning !== undefined;
}

function materializable(qualification: SignalQualification): boolean {
  return qualification.status === "qualified" || qualification.status === "high_confidence_signal";
}

function statusStrength(qualification: SignalQualification): number {
  return ({ rejected: 0, weak_candidate: 1, qualified: 2, high_confidence_signal: 3 } as const)[qualification.status];
}

function changedTarget(actual: SignalQualification, shadow: SignalQualification): boolean {
  return actual.demand_target_type !== shadow.demand_target_type || actual.demand_target_name?.toLocaleLowerCase() !== shadow.demand_target_name?.toLocaleLowerCase() || actual.source_products.map((value) => value.toLocaleLowerCase()).join("|") !== shadow.source_products.map((value) => value.toLocaleLowerCase()).join("|");
}

/** Deterministic, calibration-only classification. It never asserts ground truth. */
export function compareSemanticShadowQualification(actual: SignalQualification, shadow: SignalQualification): SemanticShadowComparison {
  const impact: ShadowImpact[] = [];
  const actualMaterializable = materializable(actual);
  const shadowMaterializable = materializable(shadow);
  if (!actualMaterializable && shadowMaterializable) impact.push("would_become_qualified");
  if (actualMaterializable && !shadowMaterializable) impact.push("would_become_unqualified");
  if (shadow.status !== actual.status && shadowMaterializable === actualMaterializable) {
    if (statusStrength(shadow) > statusStrength(actual)) impact.push("would_strengthen");
    if (statusStrength(shadow) < statusStrength(actual)) impact.push("would_weaken");
  }
  if (actual.status === shadow.status) {
    if (shadow.confidence > actual.confidence + 0.05 || shadow.demand_quality_score > actual.demand_quality_score + 0.05 || shadow.evidence_spans.length > actual.evidence_spans.length) impact.push("would_strengthen");
    if (shadow.confidence < actual.confidence - 0.05 || shadow.demand_quality_score < actual.demand_quality_score - 0.05 || shadow.evidence_spans.length < actual.evidence_spans.length) impact.push("would_weaken");
  }
  if (actual.demand_direction !== shadow.demand_direction) impact.push("would_change_direction");
  if (changedTarget(actual, shadow)) impact.push("would_change_target");
  return { actual, shadow, impact: impact.length ? [...new Set(impact)] : ["no_change"] };
}

export type SemanticShadowComparisonDiagnostics = {
  shadowComparisonCount: number;
  noChangeCount: number;
  wouldStrengthenCount: number;
  wouldWeakenCount: number;
  wouldBecomeQualifiedCount: number;
  wouldBecomeUnqualifiedCount: number;
  directionChangeCount: number;
  targetChangeCount: number;
  actualQualifiedCountAmongCompared: number;
  shadowQualifiedCountAmongCompared: number;
};

export function summarizeSemanticShadowComparisons(comparisons: SemanticShadowComparison[]): SemanticShadowComparisonDiagnostics {
  const count = (impact: ShadowImpact) => comparisons.filter((comparison) => comparison.impact.includes(impact)).length;
  return {
    shadowComparisonCount: comparisons.length,
    noChangeCount: count("no_change"),
    wouldStrengthenCount: count("would_strengthen"),
    wouldWeakenCount: count("would_weaken"),
    wouldBecomeQualifiedCount: count("would_become_qualified"),
    wouldBecomeUnqualifiedCount: count("would_become_unqualified"),
    directionChangeCount: count("would_change_direction"),
    targetChangeCount: count("would_change_target"),
    actualQualifiedCountAmongCompared: comparisons.filter((comparison) => materializable(comparison.actual)).length,
    shadowQualifiedCountAmongCompared: comparisons.filter((comparison) => materializable(comparison.shadow)).length,
  };
}
