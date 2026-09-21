"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="dashboard-page dashboard-state dashboard-state-error" role="alert">
      <p className="dashboard-eyebrow">Workspace unavailable</p>
      <h1>We couldn’t load this workspace.</h1>
      <p>That may be temporary. Try again, and if it continues, check your session and source connections.</p>
      <button className="dashboard-button dashboard-button-primary" type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
