import type { ExperimentResultRow, ExperimentRow, ExperimentVariantRow } from "@/server/db/database.helpers";
import { formatPercent } from "./dashboard-utils";

type VariantResult = { variantId: string; isControl: boolean; conversionRate: number; uniqueExposedSubjects: number; absoluteDeltaFromControl: number | null };

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
  directional: "Directional",
  completed: "Completed",
};

export function ExperimentCard({ experiment, variants, latestResult }: { experiment: ExperimentRow; variants: ExperimentVariantRow[]; latestResult: ExperimentResultRow | null }) {
  const control = variants.find((variant) => variant.is_control);
  const treatment = variants.find((variant) => !variant.is_control);
  const variantResults = (latestResult?.variant_results as unknown as VariantResult[] | undefined) ?? [];
  const treatmentResult = treatment ? variantResults.find((row) => row.variantId === treatment.id) : undefined;
  const style = STATUS_STYLES[experiment.status] ?? STATUS_STYLES.draft;

  return (
    <div className="experiment-card">
      <div className="experiment-card-header">
        <span className="badge" style={{ background: style.bg, color: style.text }}>{experiment.status}</span>
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
          <div className="experiment-metric-label">Lift vs control</div>
          <div className="experiment-metric-value" style={{ color: (treatmentResult?.absoluteDeltaFromControl ?? 0) > 0 ? "var(--color-positive)" : undefined }}>
            {treatmentResult?.absoluteDeltaFromControl != null ? formatPercent(treatmentResult.absoluteDeltaFromControl) : "—"}
          </div>
        </div>
        <div>
          <div className="experiment-metric-label">Result</div>
          <div className="experiment-metric-value" style={{ fontSize: 14 }}>{latestResult ? RESULT_STATE_LABEL[latestResult.result_state] : "Not started"}</div>
        </div>
        <div>
          <div className="experiment-metric-label">Sample size</div>
          <div className="experiment-metric-value">{latestResult?.total_exposed_subjects ?? 0}</div>
        </div>
        <div>
          <div className="experiment-metric-label">Primary metric</div>
          <div className="experiment-metric-value" style={{ fontSize: 14 }}>{experiment.primary_metric.replaceAll("_", " ")}</div>
        </div>
      </div>
      <div className="experiment-evidence-basis">Minimum sample size: {experiment.min_sample_size}</div>
    </div>
  );
}
