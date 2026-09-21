import type { ReactNode } from "react";

type Tone = "running" | "warning" | "neutral";

export function StatusBanner({ tone = "neutral", pulse = false, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <div className={`status-banner status-banner-${tone}`} role={tone === "warning" ? "status" : undefined}>
      {pulse ? <span className="status-banner-dot" aria-hidden="true" /> : null}
      <div>{children}</div>
    </div>
  );
}
