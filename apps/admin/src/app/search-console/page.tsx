import Link from "next/link";
import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { getAuthorizedSearchConsoleSnapshot } from "@admin/server/search-console/authorized";
import { getBrandBreakdown, buildSearchConsoleOpportunityReport } from "@admin/server/search-console/report";
import type { SearchConsoleMetrics, SearchConsoleReadySnapshot, SearchConsoleRow } from "@admin/server/search-console/model";

export const dynamic = "force-dynamic";

type SortKey = "impressions" | "clicks" | "ctr" | "position";

function validSort(value?: string): SortKey {
  return value === "clicks" || value === "ctr" || value === "position" ? value : "impressions";
}

function sortRows(rows: SearchConsoleRow[], sort: SortKey): SearchConsoleRow[] {
  const direction = sort === "position" ? 1 : -1;
  return [...rows].sort((left, right) => direction * (left[sort] - right[sort]) || left.key.localeCompare(right.key));
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("en").format(value);
}

function formatCtr(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : (value * 100).toFixed(2) + "%";
}

function formatPosition(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

function formatDelta(current: number | null | undefined, previous: number | null | undefined, percent = true): string {
  if (current === null || current === undefined || previous === null || previous === undefined) return "No comparison row";
  const delta = current - previous;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const value = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Math.abs(delta));
  if (!percent || previous === 0) return sign + value;
  return sign + value + " · " + sign + Math.abs((delta / previous) * 100).toFixed(1) + "%";
}

function previousRows(rows: SearchConsoleRow[]): Map<string, SearchConsoleRow> {
  return new Map(rows.map((row) => [row.key, row]));
}

function deltaFor(metric: SearchConsoleMetrics | null, previous: SearchConsoleMetrics | null, field: keyof SearchConsoleMetrics): string {
  const currentValue = metric?.[field];
  const previousValue = previous?.[field];
  if (currentValue === null || currentValue === undefined || previousValue === null || previousValue === undefined) return "No comparison row";
  const difference = currentValue - previousValue;
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  const change = field === "ctr"
    ? sign + (Math.abs(difference) * 100).toFixed(2) + " percentage points"
    : field === "position"
      ? sign + Math.abs(difference).toFixed(1) + " positions"
      : formatDelta(currentValue, previousValue);
  const prior = field === "ctr" ? formatCtr(previousValue) : field === "position" ? formatPosition(previousValue) : formatCount(previousValue);
  return change + " · prior " + prior;
}

function RangeLabel({ startDate, endDate, days }: { startDate: string; endDate: string; days: number }) {
  return <span>{startDate} – {endDate} PT · {days} days</span>;
}

function ComparisonText({ row, previous }: { row: SearchConsoleRow; previous?: SearchConsoleRow }) {
  return <span className="seo-comparison">{previous ? "Prior " + formatCount(previous.clicks) + " clicks (" + formatDelta(row.clicks, previous.clicks) + ") · " + formatCount(previous.impressions) + " impressions (" + formatDelta(row.impressions, previous.impressions) + ")" : "No comparison row"}</span>;
}

function QueryTable({ snapshot, sort }: { snapshot: SearchConsoleReadySnapshot; sort: SortKey }) {
  const prior = previousRows(snapshot.previousQueries);
  const rows = sortRows(snapshot.queries, sort);
  if (rows.length === 0) return <DataState state="empty" detail="No query rows were returned for the finalized period. This does not establish zero search traffic; Google may omit low-volume and anonymized queries." />;
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable Search Console query results">
      <table className="seo-table">
        <caption className="sr-only">Search queries returned by Google Search Console for the finalized period.</caption>
        <thead><tr><th scope="col">Query</th><th scope="col">Clicks</th><th scope="col">Impressions</th><th scope="col">CTR</th><th scope="col">Position</th><th scope="col">Comparable period</th></tr></thead>
        <tbody>{rows.slice(0, 100).map((row) => {
          const previous = prior.get(row.key);
          return <tr key={row.key}>
            <th scope="row">{row.key}</th><td>{formatCount(row.clicks)}</td><td>{formatCount(row.impressions)}</td><td>{formatCtr(row.ctr)}</td><td>{formatPosition(row.position)}</td><td><ComparisonText row={row} previous={previous} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function PageTable({ snapshot, sort }: { snapshot: SearchConsoleReadySnapshot; sort: SortKey }) {
  const prior = previousRows(snapshot.previousPages);
  const rows = sortRows(snapshot.pages, sort);
  if (rows.length === 0) return <DataState state="empty" detail="No canonical www.wanterest.com landing-page rows were returned for the finalized period." />;
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable Search Console landing page results">
      <table className="seo-table">
        <caption className="sr-only">Canonical landing pages returned by Google Search Console.</caption>
        <thead><tr><th scope="col">Canonical landing page</th><th scope="col">Clicks</th><th scope="col">Impressions</th><th scope="col">CTR</th><th scope="col">Position</th><th scope="col">Comparable period</th></tr></thead>
        <tbody>{rows.slice(0, 100).map((row) => {
          const previous = prior.get(row.key);
          return <tr key={row.key}>
            <th scope="row"><a className="seo-page-link" href={row.key} target="_blank" rel="noreferrer">{row.key}</a></th>
            <td>{formatCount(row.clicks)}</td><td>{formatCount(row.impressions)}</td><td>{formatCtr(row.ctr)}</td><td>{formatPosition(row.position)}</td><td><ComparisonText row={row} previous={previous} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function QueryPagePairs({ snapshot }: { snapshot: SearchConsoleReadySnapshot }) {
  const previous = previousRows(snapshot.previousQueryPages);
  if (snapshot.queryPages.length === 0) return <DataState state="empty" detail="The API returned no query-to-page pairs for this period. Paired dimensions can omit more data than query-only and page-only reports." />;
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable query and landing page pairs">
      <table className="seo-table seo-pairs-table">
        <caption className="sr-only">Search queries paired with canonical landing pages.</caption>
        <thead><tr><th scope="col">Query</th><th scope="col">Canonical landing page</th><th scope="col">Clicks</th><th scope="col">Impressions</th><th scope="col">Position</th></tr></thead>
        <tbody>{snapshot.queryPages.slice(0, 30).map((row) => {
          let pair: unknown;
          try { pair = JSON.parse(row.key); } catch { pair = null; }
          if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") return null;
          const prior = previous.get(row.key);
          return <tr key={row.key}><th scope="row">{pair[0]}</th><td>{pair[1]}</td><td>{formatCount(row.clicks)}{prior ? <small className="seo-prior-value">Prior {formatCount(prior.clicks)}</small> : null}</td><td>{formatCount(row.impressions)}{prior ? <small className="seo-prior-value">Prior {formatCount(prior.impressions)}</small> : null}</td><td>{formatPosition(row.position)}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function Overview({ snapshot, sort }: { snapshot: SearchConsoleReadySnapshot; sort: SortKey }) {
  const brand = getBrandBreakdown(snapshot.queries);
  const report = buildSearchConsoleOpportunityReport(snapshot);
  const metrics = snapshot.metrics;
  const tiles = [
    { label: "Clicks", value: formatCount(metrics?.clicks), prior: deltaFor(metrics, snapshot.previousMetrics, "clicks") },
    { label: "Impressions", value: formatCount(metrics?.impressions), prior: deltaFor(metrics, snapshot.previousMetrics, "impressions") },
    { label: "Click-through rate", value: formatCtr(metrics?.ctr), prior: deltaFor(metrics, snapshot.previousMetrics, "ctr") },
    { label: "Average position", value: formatPosition(metrics?.position), prior: deltaFor(metrics, snapshot.previousMetrics, "position") },
  ];
  const opportunitiesLabel: Record<string, string> = {
    high_impressions_weak_ctr: "Impressions without clicks",
    near_page_one: "Near page one",
    rising_query: "Rising non-branded query",
    declining_page: "Declining landing page",
  };

  return (
    <>
      {snapshot.state === "empty" && <div className="seo-state-banner" role="status"><strong>No rows in the finalized period.</strong><span>This is an empty API result, not a confirmed zero-traffic measurement. Google may omit anonymized or low-volume query rows.</span></div>}
      <section className="seo-connection-row" aria-label="Search Console connection">
        <span className="seo-connected-dot" aria-hidden="true" />
        <strong>Connected</strong><span>Restricted property access</span><span className="seo-property">{snapshot.property}</span>
      </section>
      <section className="metric-grid seo-metric-grid" aria-label="Search Console performance">
        {tiles.map((tile) => <article className="metric-card seo-metric" key={tile.label}>
          <div className="metric-top"><span>{tile.label}</span><span className="seo-final-tag">FINAL</span></div>
          <strong>{tile.value}</strong>
          <p>{tile.prior}</p>
        </article>)}
      </section>
      <p className="source-stamp seo-range-stamp"><span>{snapshot.source}</span><RangeLabel {...snapshot.period} /><span>Compared with {snapshot.comparison.startDate} – {snapshot.comparison.endDate} PT</span><time>Refreshed {snapshot.checkedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(snapshot.checkedAt)) + " UTC" : "time unavailable"}</time></p>
      <section className={"seo-freshness " + snapshot.freshness.state} aria-label="Search Console data freshness">
        <div><span className="eyebrow">DATA MATURITY</span><strong>{snapshot.freshness.state === "provisional" ? "Recent data is still processing" : snapshot.freshness.state === "settled" ? "Recent data checked" : "Recent maturity unknown"}</strong></div>
        <p>{snapshot.freshness.detail}</p>
        <small>Most recent date returned: {snapshot.freshness.latestAvailableDate ?? "Unavailable"} PT · First incomplete date: {snapshot.freshness.firstIncompleteDate ?? "Not reported"}</small>
      </section>
      {brand ? <section className="panel seo-brand-panel" aria-labelledby="brand-heading">
        <div className="panel-heading"><div><p className="eyebrow">QUERY CLASSIFICATION</p><h2 id="brand-heading">Branded and non-branded</h2></div><span className="panel-meta">{brand.totalReturnedRows} returned query rows</span></div>
        <div className="seo-brand-grid">
          <div><span>Branded · Wanterest variants</span><strong>{formatCount(brand.branded.clicks)} clicks</strong><small>{formatCount(brand.branded.impressions)} impressions · {brand.branded.rows} rows</small></div>
          <div><span>Non-branded</span><strong>{formatCount(brand.nonBranded.clicks)} clicks</strong><small>{formatCount(brand.nonBranded.impressions)} impressions · {brand.nonBranded.rows} rows</small></div>
        </div>
        <p className="seo-footnote">Classification recognizes the literal brand forms “wanterest” and “wanterest.com” at word boundaries. Totals describe only returned query rows; anonymized queries and rows outside the set returned by the API are not inferred.</p>
      </section> : <section className="panel seo-brand-panel"><div className="panel-heading"><div><p className="eyebrow">QUERY CLASSIFICATION</p><h2>Branded and non-branded</h2></div></div><DataState state="empty" detail="No query rows are available for classification." /></section>}
      <section className="panel seo-opportunities" aria-labelledby="opportunity-heading">
        <div className="panel-heading"><div><p className="eyebrow">PRIVATE OPPORTUNITY REPORT</p><h2 id="opportunity-heading">Review-worthy signals</h2></div><span className="panel-meta">Generated on request · no changes are applied</span></div>
        {report.opportunities.length === 0 ? <DataState state="empty" detail="No opportunity met the conservative evidence thresholds for these returned rows." /> :
          <div className="seo-opportunity-list">{report.opportunities.map((opportunity) => <article className="seo-opportunity" key={opportunity.id}>
            <div><span className="seo-opportunity-type">{opportunitiesLabel[opportunity.type]}</span><strong>{opportunity.entity}</strong></div>
            <p>{opportunity.reason}<br /><span>{opportunity.suggestedReview}</span></p>
            <div className="seo-opportunity-evidence"><span>{formatCount(opportunity.current.clicks)} clicks · {formatCount(opportunity.current.impressions)} impressions</span><small>{opportunity.previous ? "Prior: " + formatCount(opportunity.previous.clicks) + " clicks · " + formatCount(opportunity.previous.impressions) + " impressions" : "No comparable row"} · sufficient sample</small></div>
          </article>)}</div>}
        <p className="seo-footnote">Rules use minimum impression and change thresholds. Results are deduplicated by rule and entity within this generated report; no report history is persisted.</p>
      </section>
      <form className="seo-sort-form" method="get" aria-label="Sort Search Console tables">
        <label htmlFor="seo-sort">Sort queries and pages by</label>
        <select id="seo-sort" name="sort" defaultValue={sort}>
          <option value="impressions">Impressions · high to low</option>
          <option value="clicks">Clicks · high to low</option>
          <option value="ctr">CTR · high to low</option>
          <option value="position">Position · low to high</option>
        </select>
        <button className="filter-button" type="submit">Apply sort</button>
      </form>
      <section className="panel seo-data-panel" id="queries" aria-labelledby="queries-heading">
        <div className="panel-heading"><div><p className="eyebrow">SEARCH TERMS</p><h2 id="queries-heading">Queries</h2></div><span className="panel-meta">Top returned rows · maximum 100 shown</span></div>
        <QueryTable snapshot={snapshot} sort={sort} />
      </section>
      <section className="panel seo-data-panel" id="pages" aria-labelledby="pages-heading">
        <div className="panel-heading"><div><p className="eyebrow">LANDING PAGES</p><h2 id="pages-heading">Canonical pages</h2></div><span className="panel-meta">https://www.wanterest.com only · maximum 100 shown</span></div>
        <PageTable snapshot={snapshot} sort={sort} />
      </section>
      <section className="panel seo-data-panel" id="query-pages" aria-labelledby="query-pages-heading">
        <div className="panel-heading"><div><p className="eyebrow">PAIRING</p><h2 id="query-pages-heading">Queries and landing pages</h2></div><span className="panel-meta">Top 30 returned pairs · comparison values where present</span></div>
        <QueryPagePairs snapshot={snapshot} />
      </section>

      <p className="data-footnote">Headline metrics and query rows cover the full Search Console domain property; the page table is limited to canonical www.wanterest.com URLs. The Google API returns a bounded set of rows and can omit anonymized or lower-volume queries. Position is an average, not a linear performance score. This surface is read-only and does not submit indexing requests, rewrite pages, or modify Search Console.</p>
    </>
  );
}

export default async function SearchConsolePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { context, snapshot } = await getAuthorizedSearchConsoleSnapshot();
  const params = await searchParams;
  const sort = validSort(params.sort);

  return (
    <ConsoleShell context={context} active="/search-console">
      <PageHeading eyebrow="ORGANIC / SEARCH CONSOLE" title="Search, measured carefully." detail="Private, read-only Google Search performance and evidence-backed review signals." aside={<Link className="quiet-link" href="/">← Overview</Link>} />
      {snapshot.state === "not_configured" ? <section className="panel seo-setup-panel" aria-labelledby="gsc-not-configured">
        <span className="seo-setup-mark" aria-hidden="true">○</span><p className="eyebrow">PRIVATE DATA SOURCE</p><h2 id="gsc-not-configured">Search Console not configured</h2>
        <p>{snapshot.reason}</p><p>No search metrics or sample rows are shown. The page remains available for authorized Admin members while production OAuth access is configured.</p>
      </section> : null}
      {snapshot.state === "unavailable" ? <section className="panel seo-setup-panel" aria-labelledby="gsc-unavailable">
        <span className="seo-setup-mark" aria-hidden="true">◷</span><p className="eyebrow">SOURCE UNAVAILABLE</p><h2 id="gsc-unavailable">Search Console could not be read</h2>
        <p>{snapshot.reason}</p><p>Check the connection and try again. Credentials and raw Google responses are not included here.</p>
        <SourceStamp source={snapshot.source} range={snapshot.period.startDate + " – " + snapshot.period.endDate + " PT"} refreshedAt={snapshot.checkedAt} />
      </section> : null}
      {snapshot.state === "available" || snapshot.state === "empty" ? <Overview snapshot={snapshot} sort={sort} /> : null}
    </ConsoleShell>
  );
}
