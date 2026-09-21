import type { ReactNode } from "react";

import { InsightsTabs } from "@/components/dashboard/insights-tabs";

export default function InsightsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Insights</p>
        <h1>Insights</h1>
        <p className="dashboard-subtitle">Structured evidence behind what your market wants, and where it&rsquo;s moving.</p>
      </header>
      <InsightsTabs />
      {children}
    </section>
  );
}
