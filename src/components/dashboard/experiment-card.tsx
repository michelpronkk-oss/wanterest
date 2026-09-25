import type { ExperimentResultRow, ExperimentRow, ExperimentVariantRow } from "@/server/db/database.helpers";
import { formatPercent } from "./dashboard-utils";

type LegacyVariantResult = { variantId: string; isControl: boolean; conversionRate: number; uniqueExposedSubjects: number; absoluteDeltaFromControl: number | null };
type ArmResult = { variantId: string; isControl: boolean; exposed: number; converted: number; rate: number | null };

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  running: { bg: "var(--color-accent-tint)", text: "var(--color-accent-ink)" },
  draft: { bg: "var(--color-chip)", text: "var(--color-ink-secondary)" },
  ready: { bg: "var(--color-chip)", text: "var(--color-ink-secondary)" },
  paused: { bg: "var(--color-chip)", text: "var(--color-ink-muted)" },
  completed: { bg: "var(--color-ink)", text: "#ffffff" },
  canceled: { bg: "var(--color-chip)", text: "var(--color-ink-faint)" },
};

const RESULT_STATE_LABEL: Record<string, string> = {
  insufficient_data: "Insufficient data",
  collecting: "Collecting",
  directional: "Descriptive only",
  completed: "Completed",
};

const OUTCOME_LABEL: Record<string, string> = {
  positive: "Met threshold",
  negative: "Opposite direction",
  neutral: "Within threshold",
  inconclusive: "Inconclusive",
  invalid: "Invalid",
};

const ATTRIBUTION_LABEL: Record<string, string> = {
  none: "No attribution",
  descriptive: "Descriptive",
  before_after_association: "Before/after association",
  controlled_comparison: "Randomized comparison",
};

const DESIGN_LABEL: Record<string, string> = {
  controlled_split: "Randomized split",
  before_after: "Before/after (manual values)",
};

export function ExperimentCard({ experiment, variants, latestResult }: { experiment: ExperimentRow; variants: ExperimentVariantRow[]; latestResult: ExperimentResultRow | null }) {
  const control = variants.find((variant) => variant.is_control);
  const treatment = variants.find((variant) => !variant.is_control);
  const style = STATUS_STYLES[experiment.status] ?? STATUS_STYLES.draft;
  const measured = Boolean(experiment.measurement_policy_version);
  const arms = (latestResult?.arm_results as unknown as ArmResult[] | null) ?? [];
  const legacyTreatment = treatment ? ((latestResult?.variant_results as unknown as LegacyVariantResult[] | undefined) ?? []).find((row) => row.variantId === treatment.id) : undefined;

  return (
    <div className="experiment-card">
      <div className="experiment-card-header">
        <span className="badge" style={{ background: style.bg, color: style.text }}>{experiment.status}</span>
        {experiment.evidence_design ? <span className="badge">{DESIGN_LABEL[experiment.evidence_design] ?? experiment.evidence_design}</span> : null}
      </div>
      <p className="experiment-title">{experiment.name}</p>
      <p className="experiment-hypothesis">{experiment.hypothesis}</p>
      {control || treatment ? (
        <div className="experiment-diff">
          <div className="action-diff-box"><div className="action-diff-box-label">Control</div>{control?.label ?? "—"}</div>
          <div className="action-diff-box"><div className="action-diff-box-label">Variant</div>{treatment?.label ?? "—"}</div>
        </div>
      ) : null}
      <div className="experiment-metrics">
        <div>
          <div className="experiment-metric-label">Outcome</div>
          <div className="experiment-metric-value" style={{ fontSize: 14 }}>
            {measured ? (latestResult?.outcome ? OUTCOME_LABEL[latestResult.outcome] : "Not measured yet") : latestResult ? RESULT_STATE_LABEL[latestResult.result_state] : "Not started"}
          </div>
        </div>
        <div>
          <div className="experiment-metric-label">Evidence</div>
          <div className="experiment-metric-value" style={{ fontSize: 14 }}>
            {measured ? (latestResult?.attribution_class ? ATTRIBUTION_LABEL[latestResult.attribution_class] : "—") : "Descriptive (legacy)"}
          </div>
        </div>
        {!measured ? (
          <div>
            <div className="experiment-metric-label">Observed difference</div>
            <div className="experiment-metric-value">{legacyTreatment?.absoluteDeltaFromControl != null ? formatPercent(legacyTreatment.absoluteDeltaFromControl) : "—"}</div>
          </div>
        ) : null}
        <div>
          <div className="experiment-metric-label">Primary metric</div>
          <div className="experiment-metric-value" style={{ fontSize: 14 }}>{experiment.primary_metric === "manual_custom" && experiment.metric_label ? experiment.metric_label : experiment.primary_metric.replaceAll("_", " ")}</div>
        </div>
      </div>
      {arms.length ? (
        <div className="experiment-evidence-basis">
          {arms.map((arm) => `${arm.isControl ? "Control" : "Treatment"}: ${arm.converted} of ${arm.exposed} exposed (${arm.rate === null ? "n/a" : formatPercent(arm.rate)})`).join(" · ")}
        </div>
      ) : null}
      {latestResult?.summary ? <div className="experiment-evidence-basis">{latestResult.summary}</div> : null}
      {experiment.closed_reason ? <div className="experiment-evidence-basis">Closed: {experiment.closed_reason.replaceAll("_", " ")}</div> : null}
      {!measured ? <div className="experiment-evidence-basis">Minimum sample size: {experiment.min_sample_size}</div> : null}
    </div>
  );
}
