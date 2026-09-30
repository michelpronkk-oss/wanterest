import Link from "next/link";
import { ConsoleShell, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { getOperationsSnapshot } from "@admin/server/operations";
import { getOverviewMetrics } from "@admin/server/overview";
import { getWebAnalyticsSnapshot } from "@admin/server/vercel-analytics";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const context = await requireAdminPermission("operations.read");
  const [overview, operations, webAnalytics] = await Promise.all([getOverviewMetrics(), getOperationsSnapshot(), getWebAnalyticsSnapshot()]);
  return (
    <ConsoleShell context={context} active="/">
      <PageHeading eyebrow="CONTROL CENTER / OVERVIEW" title="Wanterest, at a glance." detail="A measured view of access, adoption and system activity." aside={<span className="range-control">30-day operating window · UTC</span>} />
      <section aria-labelledby="lifecycle-heading" className="section-block">
        <div className="section-title-row"><div><p className="eyebrow">AUTHORITATIVE LIFECYCLE</p><h2 id="lifecycle-heading">Early Access &amp; adoption</h2></div><span className="section-meta">Source · Supabase production</span></div>
        <div className="metric-grid lifecycle-grid">{overview.metrics.map((metric) => <article className={`metric-card${metric.key === "applications" ? " metric-featured" : ""}`} key={metric.key}>
          <div className="metric-top"><span>{metric.label}</span><span className={`metric-state ${metric.state}`}>{metric.state === "available" ? "Live" : "Unavailable"}</span></div>
          <strong>{metric.value === null ? "—" : new Intl.NumberFormat("en").format(metric.value)}</strong>
          <p>{metric.range}</p>
          <SourceStamp source={metric.source} range="Exact database count" refreshedAt={metric.refreshedAt} />
        </article>)}</div>
        <p className="data-footnote">Verified means a non-null verified_at timestamp. Priority counts currently granted records. Cohorts count distinct cohorts with at least one membership. No absent or unreadable value is shown as zero.</p>
      </section>

      <div className="overview-lower-grid">
        <section className="panel traffic-panel" aria-labelledby="traffic-heading">
          <div className="panel-heading"><div><p className="eyebrow">VISITOR ANALYTICS</p><h2 id="traffic-heading">People finding Wanterest</h2></div><span className={`pill ${webAnalytics.state}`}>{webAnalytics.state === "available" ? "Connected" : "Unavailable"}</span></div>
          {webAnalytics.state === "available" ? <div className="traffic-values"><div><span>Visitors</span><strong>{new Intl.NumberFormat("en").format(webAnalytics.visitors!)}</strong></div><div><span>Page views</span><strong>{new Intl.NumberFormat("en").format(webAnalytics.pageviews!)}</strong></div></div> : <p className="panel-empty">Server-side Vercel Analytics is awaiting production API access. Visitor counts and lifecycle conversions remain separate.</p>}
          <SourceStamp source={webAnalytics.source} range={webAnalytics.range} refreshedAt={webAnalytics.refreshedAt} />
          <p className="quiet-note">Traffic only · lifecycle measurements come from database records</p>
        </section>
        <section className="panel operations-teaser" aria-labelledby="operations-heading">
          <div className="panel-heading"><div><p className="eyebrow">SYSTEM ACTIVITY</p><h2 id="operations-heading">Operations</h2></div><span className={`pill ${operations.state}`}>{operations.stateLabel}</span></div>
          <p className="panel-copy">Persisted job records and Trigger.dev production runs, refreshed on request.</p>
          <div className="mini-facts"><div><span>Jobs · last 24 hours</span><strong>{operations.jobs.value === null ? "Unavailable" : operations.jobs.value}</strong></div><div><span>Production sources</span><strong>{operations.sources.value === null ? "Unavailable" : operations.sources.value}</strong></div></div>
          <Link className="text-link" href="/operations">Open operations <span aria-hidden="true">→</span></Link>
        </section>
      </div>
    </ConsoleShell>
  );
}
