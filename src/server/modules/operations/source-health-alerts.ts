import {
  sourceHealthV1Schema,
  type SourceHealthV1Source,
} from "@/shared/source-health-v1";

export type SourceHealthAlertKind = "immediate" | "persistent" | "informational";
export type SourceHealthAlertSeverity = "critical" | "warning" | "info";

export type SourceHealthAlert = {
  sourceKey: string;
  state: SourceHealthV1Source["state"];
  kind: SourceHealthAlertKind;
  severity: SourceHealthAlertSeverity;
  reason: string;
};

export type SourceHealthAlertInput = {
  sourceKey: string;
  source: SourceHealthV1Source;
  /** Supplied by a caller that has trustworthy prior-scan history. */
  repeated?: boolean;
  /** Very-high routing priority is the only high-priority escalation signal. */
  highPriority?: boolean;
};

const immediateStates = new Set<SourceHealthV1Source["state"]>(["auth_error", "quota_exhausted", "misconfigured"]);
const deferredStates = new Set<SourceHealthV1Source["state"]>(["temporary_provider_error", "rate_limited", "permanent_provider_error", "unknown_failure"]);

/**
 * Classifies alert intent only. It does not persist, deliver, or infer
 * recurrence from the mutable source_health snapshot.
 */
export function classifySourceHealthAlert(input: SourceHealthAlertInput): SourceHealthAlert | null {
  const { sourceKey, source } = input;
  if (source.plannedQueries <= 0) return null;
  if (source.state === "healthy_with_results" || source.state === "healthy_zero_results") return null;

  if (source.state === "budget_limited" || source.state === "disabled") {
    return {
      sourceKey,
      state: source.state,
      kind: "informational",
      severity: "info",
      reason: source.state === "budget_limited" ? "The planned source was limited by scan budget." : "The planned source was disabled.",
    };
  }

  if (immediateStates.has(source.state)) {
    return {
      sourceKey,
      state: source.state,
      kind: "immediate",
      severity: "critical",
      reason: source.state === "auth_error"
        ? "The planned source rejected authentication."
        : source.state === "quota_exhausted"
          ? "The planned source exhausted provider quota."
          : "The planned source is misconfigured.",
    };
  }

  if (deferredStates.has(source.state) && (input.repeated === true || (input.highPriority === true && (source.state === "permanent_provider_error" || source.state === "unknown_failure")))) {
    return {
      sourceKey,
      state: source.state,
      kind: "persistent",
      severity: "warning",
      reason: "The planned source has a repeated or high-priority failure.",
    };
  }

  return null;
}

export function classifySourceHealthAlerts(
  value: unknown,
  recurrence: Readonly<Record<string, boolean>> = {},
): SourceHealthAlert[] {
  const parsed = sourceHealthV1Schema.safeParse(value);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.sources)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceKey, source]) => classifySourceHealthAlert({
      sourceKey,
      source,
      repeated: recurrence[sourceKey] === true,
      highPriority: source.coverageWeight >= 1,
    }))
    .filter((alert): alert is SourceHealthAlert => alert !== null);
}
