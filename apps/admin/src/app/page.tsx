import Link from "next/link";
import { ConsoleShell, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { getOperationsSnapshot } from "@admin/server/operations";
import { getOverviewMetrics, getRecentAdminActivity } from "@admin/server/overview";
import { getOverviewGrowth } from "@admin/server/growth";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const context = await requireAdminPermission("operations.read");
  const [overview, operations, webAnalytics, activity] = await Promise.all([getOverviewMetrics(), getOperationsSnapshot(), getOverviewGrowth(), getRecentAdminActivity()]);
  return (
    <ConsoleShell context={context} active="/">
      <PageHeading eyebrow="CONTROL CENTER / OVERVIEW" title="Wanterest, at a glance." detail="A measured view of access, adoption and system activity." aside={<span className="range-control">Seven-day activity · UTC</span>} />
      <section aria-labelledby="lifecycle-heading" className="section-block">
        <div className="section-title-row"><div><p className="eyebrow">AUTHORITATIVE LIFECYCLE</p><h2 id="lifecycle-heading">Early Access &amp; adoption</h2></div><span className="section-meta">Source · Supabase production</span></div>
        <div className="metric-grid lifecycle-grid">{overview.metrics.map((metric) => <article className={`metric-card${metric.key === "applications" ? " metric-featured" : ""}`} key={metric.key}>
          <div className="metric-top"><span>{metric.label}</span><span className={`metric-state ${metric.state}`}>{metric.state === "available" ? "Live" : "Unavailable"}</span></div>
          <strong>{metric.value === null ? "—" : new Intl.NumberFormat("en").format(metric.value)}</strong>
          <p>{metric.range}</p>
          <SourceStamp source={metric.source} range="Exact database count" refreshedAt={metric.refreshedAt} />
        </article>)}</div>
        <p className="data-footnote">Applications and verifications cover the last seven days. Pending invitations are issued and unexpired now; admissions are all-time. Invitation acceptance creates workspace admission and permanent cohort assignment in the same transaction. No unreadable value is shown as zero.</p>
      </section>

      <div className="overview-lower-grid">
        <section className="panel traffic-panel" aria-labelledby="traffic-heading">
          <div className="panel-heading"><div><p className="eyebrow">VISITOR ANALYTICS</p><h2 id="traffic-heading">People finding Wanterest</h2></div><span className={`pill ${webAnalytics.state}`}>{webAnalytics.state === "available" ? "Live" : webAnalytics.state === "partial" ? "Partial" : "Unavailable"}</span></div>
          {webAnalytics.visitors !== null ? <div className="traffic-values"><div><span>Visitors · 7d</span><strong>{new Intl.NumberFormat("en").format(webAnalytics.visitors)}</strong></div><div><span>Page views · 7d</span><strong>{webAnalytics.pageviews === null ? "—" : new Intl.NumberFormat("en").format(webAnalytics.pageviews)}</strong></div></div> : <p className="panel-empty">{webAnalytics.coverage} Traffic is measured separately from lifecycle records.</p>}
          {webAnalytics.trend ? <div className="overview-mini-trend" aria-label="Daily visitors and submitted applications over the last seven days">{webAnalytics.trend.map((day) => <div key={day.date} title={`${day.date}: ${day.visitors} visitors · ${day.applications} applications`}><span>{day.date.slice(5)}</span><i style={{ height: `${Math.min(100, (day.visitors ?? 0) * 5)}%` }} /><b style={{ height: `${Math.min(100, (day.applications ?? 0) * 18)}%` }} /></div>)}</div> : null}
          <SourceStamp source="Vercel Web Analytics · production project wanterest" range="Trailing 7 days · UTC" refreshedAt={webAnalytics.refreshedAt} />
          <p className="quiet-note">{webAnalytics.coverage} Traffic is not identity-linked to application records.</p>
          <Link className="text-link" href="/growth">Open Growth intelligence →</Link>
        </section>
        <section className="panel activity-teaser" aria-labelledby="recent-activity-heading">
          <div className="panel-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2 id="recent-activity-heading">Recent Admin activity</h2></div></div>
          {activity.rows === null ? <p className="panel-empty">Admin audit activity is unavailable.</p> : activity.rows.length === 0 ? <p className="panel-empty">No Admin actions recorded in the last seven days.</p> : <ul className="overview-activity-list">{activity.rows.map((row, index) => <li key={`${row.createdAt}-${index}`}><strong>{row.action.replaceAll("_", " ")}</strong><span>{row.role.replaceAll("_", " ")} · {row.outcome}</span><time>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(row.createdAt))} UTC</time></li>)}</ul>}
          <SourceStamp source={activity.source} range="Trailing 7 days" refreshedAt={activity.checkedAt} />
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
