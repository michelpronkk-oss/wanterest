import { DataState, SourceStamp } from "@admin/components/console-shell";
import type { MarketCoverageAdminSnapshot } from "@admin/server/market-coverage";

export function MarketCoveragePanel({ snapshot }: { snapshot: MarketCoverageAdminSnapshot }) {
  return <section className="panel market-coverage-panel" aria-labelledby="market-coverage-heading">
    <div className="panel-heading">
      <div><p className="eyebrow">MARKET MEMORY · COVERAGE V1</p><h2 id="market-coverage-heading">Observation by evidence family</h2></div>
      <span className="panel-meta">No aggregate coverage score</span>
    </div>
    {snapshot.state === "unavailable" ? <DataState state="unavailable" detail="The private coverage summary is unavailable. Rights or missing configuration are not treated as zero coverage." />
      : snapshot.state === "empty" || !snapshot.rows ? <div className="data-state empty" role="status"><span className="data-state-mark" aria-hidden="true">—</span><p><strong>No reviewed coverage configuration</strong><span>No market scopes or family requirements are registered yet. No provider or family is assumed healthy.</span></p></div>
        : <div className="market-coverage-grid">
          {snapshot.rows.map((row) => <article className="market-coverage-card" key={row.partition_key + row.evidence_role}>
            <div className="market-coverage-card-heading">
              <div><strong>{row.market_key.replaceAll("-", " ")}</strong><small>{row.vertical_key} · {row.source_family.replaceAll("_", " ")} · {row.evidence_role}</small></div>
              <span className={`market-coverage-state ${row.coverage_state}`}>{row.coverage_state.replaceAll("_", " ")}</span>
            </div>
            <dl>
              <Metric label="Independent roots · 30 days" value={row.independent_roots} />
              <Metric label="Provider diversity" value={row.provider_count} />
              <Metric label="Repeated-root ratio" value={row.duplicate_root_ratio} percent />
              <Metric label="Highest provider share" value={row.max_provider_root_share} percent />
              <Metric label="Published time buckets" value={row.published_month_buckets} />
              <Metric label="Geographies observed" value={row.distinct_geographies} />
              <Metric label="Active product interests" value={row.interested_products} />
            </dl>
            <p className="market-coverage-note">Availability: {row.availability_state.replaceAll("_", " ")} · rights: {row.rights_state.replaceAll("_", " ")} · latest observation: {formatDate(row.latest_observed_at)}</p>
          </article>)}
        </div>}
    <SourceStamp source={snapshot.source} range="Trailing 30 days · canonical roots · source items · UTC" refreshedAt={snapshot.checkedAt} />
    <p className="data-footnote">Rows describe reviewed family requirements. Counts are withheld unless acquisition and durable-analysis rights are explicitly permitted. Context and supply remain separate from demand; this read surface cannot launch acquisition.</p>
  </section>;
}

function Metric({ label, value, percent = false }: { label: string; value: number | null; percent?: boolean }) {
  const display = value === null ? "Unknown" : percent ? `${(value * 100).toFixed(1)}%` : new Intl.NumberFormat("en").format(value);
  return <div><dt>{label}</dt><dd>{display}</dd></div>;
}

function formatDate(value: string | null) {
  return value ? `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC` : "Not observed";
}
