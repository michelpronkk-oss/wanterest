import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { listExperimentsQuery } from "@/server/modules/experiments/commands";
import { ZeroState } from "@/components/ui/zero-state";
import { ExperimentCard } from "@/components/dashboard/experiment-card";
import { ExperimentGhostPreview } from "@/components/dashboard/experiment-ghost-preview";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { formatPercent } from "@/components/dashboard/dashboard-utils";

const EXPERIMENT_PIPELINE = ["Evidence", "Action", "Hypothesis", "Variant", "Result", "Learning"].map((label) => ({ label }));

export default async function ExperimentsPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Experiments</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }
  if (!product) {
    return (
      <section className="dashboard-page">
        <ZeroState
          eyebrow="Experiments"
          title="Measure whether your next move actually works."
          body="Experiments connect evidence to action, hypothesis, variant, result, and learning — so you know whether a change actually moved the outcome."
          primaryCta={{ label: "Add product", href: "/app/setup/product" }}
        />
        <div style={{ marginTop: 24, maxWidth: 640 }}>
          <PipelineFlow stages={EXPERIMENT_PIPELINE} compact />
        </div>
        <div style={{ marginTop: 24, maxWidth: 460 }}>
          <ExperimentGhostPreview />
        </div>
      </section>
    );
  }

  const experiments = await listExperimentsQuery(workspace.id, product.id);
  const running = experiments.filter((entry) => entry.experiment.status === "running").length;
  const completed = experiments.filter((entry) => entry.experiment.status === "completed");
  const lifts = completed
    .map((entry) => {
      const results = entry.latestResult?.variant_results as unknown as Array<{ isControl: boolean; absoluteDeltaFromControl: number | null }> | undefined;
      return results?.find((row) => !row.isControl)?.absoluteDeltaFromControl ?? null;
    })
    .filter((value): value is number => value !== null);
  const avgLift = lifts.length ? lifts.reduce((sum, value) => sum + value, 0) / lifts.length : null;

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Experiments</p>
        <h1>Experiments</h1>
        <p className="dashboard-subtitle">Measuring whether evidence-backed changes actually move real outcomes.</p>
      </header>

      {experiments.length > 0 ? (
        <div className="actions-summary">
          <div className="actions-summary-item"><strong>{running}</strong><span>Running</span></div>
          <div className="actions-summary-item"><strong>{completed.length}</strong><span>Completed</span></div>
          <div className="actions-summary-item"><strong style={{ color: "var(--color-positive)" }}>{avgLift !== null ? formatPercent(avgLift) : "—"}</strong><span>Average validated lift</span></div>
        </div>
      ) : null}

      {experiments.length === 0 ? (
        <div style={{ maxWidth: 460 }}>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-secondary)", marginBottom: 16 }}>Create experiments from evidence-backed Actions to measure what changes outcomes.</p>
          <ExperimentGhostPreview />
          <div style={{ marginTop: 16 }}>
            <Link className="dashboard-button dashboard-button-secondary" href="/app/actions">View Actions</Link>
          </div>
        </div>
      ) : (
        <div className="experiment-list">
          {experiments.map((entry) => (
            <ExperimentCard key={entry.experiment.id} experiment={entry.experiment} variants={entry.variants} latestResult={entry.latestResult} />
          ))}
        </div>
      )}
    </section>
  );
}
