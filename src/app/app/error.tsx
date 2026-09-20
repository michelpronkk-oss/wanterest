"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="dashboard-page dashboard-state dashboard-state-error" role="alert">
      <p className="dashboard-eyebrow">Workspace unavailable</p>
      <h1>We couldn’t load this workspace.</h1>
      <p>Try again. If the problem continues, check the workspace session and source connections.</p>
      <button className="dashboard-button dashboard-button-primary" type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
