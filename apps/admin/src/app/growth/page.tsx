import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { fillLifecycleDays, getGrowthSnapshot, parseGrowthPeriod } from "@admin/server/growth";

export const dynamic = "force-dynamic";

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const context = await requireAdminPermission("analytics.read");
  const params = await searchParams;
  const period = parseGrowthPeriod(params);
  const snapshot = await getGrowthSnapshot(period);
  const days = fillLifecycleDays(period, snapshot.lifecycleDays);
  const sum = (field: "submitted" | "verified" | "priority" | "approved" | "sent" | "accepted" | "admitted") => days?.reduce((total, row) => total + row[field], 0) ?? null;
  const applications = sum("submitted");
  const verified = sum("verified");
  const admitted = sum("admitted");
  const conversion = snapshot.visitors.value && applications !== null ? (applications / snapshot.visitors.value) * 100 : null;
  const chartRows = days?.map((row) => ({ date: row.date, visitors: snapshot.dailyTraffic?.find((traffic) => traffic.date === row.date)?.visitors ?? 0, applications: row.submitted })) ?? null;
  const max = Math.max(1, ...(chartRows ?? []).flatMap((row) => [row.visitors, row.applications]));
  const categoryTotals = new Map<string, number>();
  for (const referrer of snapshot.referrers ?? []) categoryTotals.set(referrer.category, (categoryTotals.get(referrer.category) ?? 0) + referrer.pageviews);

  return <ConsoleShell context={context} active="/growth">
    <PageHeading eyebrow="INTELLIGENCE / GROWTH" title="Measure what moves." detail="Visitor telemetry and product lifecycle records, held as separate sources of truth." aside={<form className="growth-period-form" method="get" aria-label="Growth report period">
      <label>Period<select name="period" defaultValue={period.label.startsWith("Today") ? "today" : period.label.startsWith("Last 7") ? "7d" : period.label.startsWith("Custom") ? "custom" : "30d"}>
        <option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom dates</option>
      </select></label>
      <label>From<input name="from" type="date" defaultValue={params.from ?? ""} /></label>
      <label>To<input name="to" type="date" defaultValue={params.to ?? ""} /></label>
      <button className="filter-button" type="submit">Apply</button>
    </form>} />

    <div className="growth-kpi-grid" aria-label="Growth key performance indicators">
      <MetricCard label="Unique visitors" value={snapshot.visitors.value} state={snapshot.trafficState} note="Daily request-derived visitor measurement · Vercel" />
      <MetricCard label="Pageviews" value={snapshot.pageviews.value} state={snapshot.trafficState} note="Public page views · Vercel Web Analytics" />
      <MetricCard label="Applications submitted" value={applications} state={snapshot.lifecycleState} note="waitlist_applications.created_at · Supabase" />
      <MetricCard label="Email verified" value={verified} state={snapshot.lifecycleState} note="verification_succeeded · Supabase" />
      <MetricCard label="Workspaces admitted" value={admitted} state={snapshot.lifecycleState} note="workspace_admissions.admitted_at · Supabase" />
      <article className="growth-card"><span>Applications / visitors</span><strong>{conversion === null ? "—" : `${conversion.toFixed(1)}%`}</strong><small>{conversion === null ? "Unavailable without both sources." : "Independent aggregate ratio; visitors are not identity-matched to applicants."}</small></article>
    </div>
    <p className="growth-period-stamp">{period.label} · All dates UTC · Query covers {period.days} day{period.days === 1 ? "" : "s"}</p>

    <div className="growth-layout">
      <section className="panel growth-panel" aria-labelledby="trend-heading">
        <div className="panel-heading"><div><p className="eyebrow">TRAFFIC + LIFECYCLE</p><h2 id="trend-heading">Daily trend</h2></div><span className={`pill ${snapshot.trafficState}`}>{snapshot.trafficState === "available" ? "Live" : snapshot.trafficState === "partial" ? "Partial" : "Unavailable"}</span></div>
        {!chartRows || snapshot.dailyTraffic === null || snapshot.trafficState === "unavailable" ? <DataState state="unavailable" detail={snapshot.coverage} /> : <>
          <div className="growth-chart" role="img" aria-label="Daily visitors and submitted applications. The visitor series is Vercel aggregate telemetry; applications are Supabase lifecycle records.">
            {chartRows.map((row) => <div className="growth-chart-row" key={row.date} title={`${row.date}: ${row.visitors} visitors, ${row.applications} applications`}>
              <span>{row.date.slice(5)}</span><div className="chart-track"><i className="chart-bar" style={{ width: `${Math.max(row.visitors === 0 ? 0 : 2, row.visitors / max * 100)}%` }} /><i className="chart-bar applications" style={{ width: `${Math.max(row.applications === 0 ? 0 : 2, row.applications / max * 100)}%` }} /></div><span>{row.visitors}</span>
            </div>)}
          </div>
          <div className="growth-legend"><span><i />Visitors · Vercel</span><span><i className="applications" />Applications · Supabase</span></div>
          <p>{snapshot.coverage} The aggregate ratio is not a person-level conversion rate.</p>
        </>}
        <SourceStamp source={`${snapshot.visitors.source} · ${snapshot.lifecycleSource}`} range={period.label} refreshedAt={snapshot.refreshedAt} />
      </section>

      <section className="panel growth-panel" aria-labelledby="funnel-heading">
        <div className="panel-heading"><div><p className="eyebrow">AUTHORITATIVE STAGES</p><h2 id="funnel-heading">Early Access funnel</h2></div></div>
        <ol className="growth-funnel">
          <FunnelItem label="All visitors" value={snapshot.visitors.value} source="Vercel aggregate visitors" unavailable={snapshot.visitors.state === "unavailable"} />
          <FunnelItem label="Homepage views" value={snapshot.homepagePageviews.value} source="Vercel · requestPath / pageviews" unavailable={snapshot.homepagePageviews.state === "unavailable"} />
          <FunnelItem label="Early Access page visitors" value={snapshot.earlyAccessVisitors.value} source="Vercel · /waitlist page views" unavailable={snapshot.earlyAccessVisitors.state === "unavailable"} />
          <FunnelItem label="Application started" value={snapshot.applicationStarted.value} source="Vercel · first form interaction; aggregate custom event" unavailable={snapshot.applicationStarted.state === "unavailable"} />
          <FunnelItem label="Applications submitted" value={applications} source="Supabase · application records created" unavailable={snapshot.lifecycleState === "unavailable"} />
          <FunnelItem label="Email verified" value={verified} source="Supabase · verification events" unavailable={snapshot.lifecycleState === "unavailable"} />
          <FunnelItem label="Invitations sent" value={sum("sent")} source="Supabase · issued and reissued invite events" unavailable={snapshot.lifecycleState === "unavailable"} />
          <FunnelItem label="Invitations accepted" value={sum("accepted")} source="Supabase · accepted invite events" unavailable={snapshot.lifecycleState === "unavailable"} />
          <FunnelItem label="Workspaces admitted" value={admitted} source="Supabase · workspace admissions" unavailable={snapshot.lifecycleState === "unavailable"} />
        </ol>
        <p className="growth-disclaimer">Traffic, page views, and lifecycle counts are different populations. Funnel rows show period totals, not user-level drop-off. Invitation acceptance admits the workspace and assigns its permanent cohort atomically.</p>
      </section>

      <section className="panel growth-panel" aria-labelledby="source-heading">
        <div className="panel-heading"><div><p className="eyebrow">ACQUISITION</p><h2 id="source-heading">Traffic sources</h2></div></div>
        {snapshot.referrers === null ? <DataState state="unavailable" detail="Referrer host aggregation is unavailable from Vercel Web Analytics." /> : <ul className="growth-list">
          {["Direct", "Organic search", "Social", "Referral", "Other / unknown"].map((category) => <li key={category}><span>{category}</span><strong>{new Intl.NumberFormat("en").format(categoryTotals.get(category) ?? 0)} pageviews</strong></li>)}
          <li><span>Campaign tagged · UTM source</span><strong>{snapshot.utmSource === null ? "Unavailable" : `${new Intl.NumberFormat("en").format(snapshot.utmSource.reduce((total, row) => total + row.pageviews, 0))} pageviews`}</strong></li>
          {snapshot.referrers.filter((row) => row.category !== "Direct" && row.category !== "Organic search" && row.category !== "Social" && row.category !== "Referral").map((row) => <li key={row.label}><span>{row.label} · other</span><strong>{new Intl.NumberFormat("en").format(row.pageviews)} pageviews</strong></li>)}
        </ul>}
        <p>Referrer category totals count pageviews. A single visitor may use more than one source during the period.</p>
      </section>

      <section className="panel growth-panel" aria-labelledby="pages-heading">
        <div className="panel-heading"><div><p className="eyebrow">CONTENT</p><h2 id="pages-heading">Top pages</h2></div></div>
        {snapshot.topPages === null ? <DataState state="unavailable" detail="Page-path aggregation is unavailable." /> : snapshot.topPages.length === 0 ? <DataState state="empty" detail="No page traffic was returned for this period." /> : <ul className="growth-list">{snapshot.topPages.map((row) => <li key={row.label}><span><code>{row.label}</code></span><strong>{new Intl.NumberFormat("en").format(row.pageviews)}</strong></li>)}</ul>}
        <p>Top pages are page views by path. The API does not provide entry-page/session attribution, so landing pages are unavailable.</p>
      </section>

      <section className="panel growth-panel" aria-labelledby="campaign-heading">
        <div className="panel-heading"><div><p className="eyebrow">CAMPAIGNS</p><h2 id="campaign-heading">UTM dimensions</h2></div><span className={`pill ${snapshot.utmState}`}>{snapshot.utmState === "available" ? "Available" : "Unavailable"}</span></div>
        {snapshot.utmState === "unavailable" ? <DataState state="unavailable" detail="Vercel API access or the current Web Analytics plan does not expose UTM dimensions." /> : <div className="utm-grid">
          <DimensionList title="Source" rows={snapshot.utmSource} dimension="utmSource" />
          <DimensionList title="Medium" rows={snapshot.utmMedium} dimension="utmMedium" />
          <DimensionList title="Campaign" rows={snapshot.utmCampaign} dimension="utmCampaign" />
        </div>}
        <p>UTM pageviews are grouped independently and may overlap with referrer attribution.</p>
      </section>
    </div>

    <section className="panel growth-panel growth-capabilities" aria-labelledby="measurement-heading">
      <div className="panel-heading"><div><p className="eyebrow">MEASUREMENT BOUNDARIES</p><h2 id="measurement-heading">What these numbers can tell us</h2></div></div>
      <div className="measurement-grid">
        <div><strong>Visitors</strong><p>{snapshot.coverage} Vercel&rsquo;s visitor measurement is privacy-preserving and resets daily; it is not a persistent account identity.</p></div>
        <div><strong>Sessions</strong><p>Unavailable. The queried API returns aggregate visitors and pageviews, not session counts.</p></div>
        <div><strong>Landing pages</strong><p>Unavailable. Top page paths do not tell us which page began a visit.</p></div>
        <div><strong>Conversions</strong><p>Applications, verification, invitation, acceptance, and admission counts are authoritative database events. Traffic is not joined to customer identity.</p></div>
      </div>
    </section>
  </ConsoleShell>;
}

function MetricCard({ label, value, state, note }: { label: string; value: number | null; state: string; note: string }) {
  const status = state === "available" ? "Live" : state === "partial" ? "Partial" : "Unavailable";
  return <article className="growth-card"><span>{label} · {status}</span><strong>{value === null ? "—" : new Intl.NumberFormat("en").format(value)}</strong><small>{note}</small></article>;
}

function FunnelItem({ label, value, source, unavailable }: { label: string; value: number | null; source: string; unavailable: boolean }) {
  return <li><span>{label}</span><strong className={unavailable || value === null ? "unavailable-value" : undefined}>{unavailable || value === null ? "Unavailable" : new Intl.NumberFormat("en").format(value)}</strong><small>{source}</small></li>;
}

function DimensionList({ title, rows, dimension }: { title: string; rows: Array<{ label: string; pageviews: number }> | null; dimension: string }) {
  return <div><h3>{title}</h3>{rows === null ? <p>Unavailable</p> : rows.length === 0 ? <p>No tagged traffic</p> : <ul className="growth-list">{rows.map((row) => <li key={row.label}><span>{row.label || "(none)"}</span><strong>{new Intl.NumberFormat("en").format(row.pageviews)}</strong></li>)}</ul>}<span className="sr-only">Grouped by {dimension}.</span></div>;
}
