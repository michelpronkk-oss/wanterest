type Stage = { label: string; hint?: string };

/** Compact horizontal process pipeline used as a structural teaser (Home, Experiments). No fabricated data — labels only. */
export function PipelineFlow({ stages, compact = false }: { stages: Stage[]; compact?: boolean }) {
  return (
    <div className={`pipeline-flow${compact ? " is-compact" : ""}`}>
      {stages.map((stage, index) => (
        <div className="pipeline-flow-step" key={stage.label}>
          {compact ? (
            <span className="pipeline-flow-step-label">{stage.label}</span>
          ) : (
            <>
              <span className="pipeline-flow-step-index">{index + 1}</span>
              <span className="pipeline-flow-step-label">{stage.label}</span>
              {stage.hint ? <span className="pipeline-flow-step-hint">{stage.hint}</span> : null}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
