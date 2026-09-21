import Link from "next/link";

import { intentTypeSchema } from "@/server/modules/intelligence";

type Props = {
  intentType?: string;
  sourceKey?: string;
  lifecycleStatus?: string;
  minimumScore?: string;
  from?: string;
  to?: string;
  sources: string[];
  query?: string;
};

function chipHref(params: URLSearchParams, key: string, value: string | undefined) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  const encoded = next.toString();
  return encoded ? `/app/signals?${encoded}` : "/app/signals";
}

export function SignalFilters({ intentType, sourceKey, lifecycleStatus, minimumScore, from, to, sources, query }: Props) {
  const baseParams = new URLSearchParams();
  if (sourceKey) baseParams.set("source", sourceKey);
  if (lifecycleStatus) baseParams.set("status", lifecycleStatus);
  if (minimumScore) baseParams.set("min_score", minimumScore);
  if (from) baseParams.set("from", from);
  if (to) baseParams.set("to", to);
  if (query) baseParams.set("q", query);

  return (
    <div>
      <div className="signal-filters">
        <div className="filter-chips">
          <Link href={chipHref(baseParams, "intent", undefined)} className={`filter-chip${!intentType ? " is-active" : ""}`}>All</Link>
          {intentTypeSchema.options.map((value) => (
            <Link key={value} href={chipHref(baseParams, "intent", value)} className={`filter-chip${intentType === value ? " is-active" : ""}`}>
              {value.replaceAll("_", " ")}
            </Link>
          ))}
        </div>
        <span className="signal-filters-sort">Sorted: opportunity score</span>
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--color-ink-muted)", marginBottom: 10 }}>More filters</summary>
        <form className="signal-filter-grid" method="get">
          {intentType ? <input type="hidden" name="intent" value={intentType} /> : null}
          {query ? <input type="hidden" name="q" value={query} /> : null}
          <label className="dashboard-field"><span>Source</span><select name="source" defaultValue={sourceKey ?? ""}><option value="">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="dashboard-field"><span>Lifecycle</span><select name="status" defaultValue={lifecycleStatus ?? ""}><option value="">All statuses</option><option value="active">Active</option><option value="saved">Saved</option><option value="dismissed">Dismissed</option><option value="archived">Archived</option></select></label>
          <label className="dashboard-field"><span>Min score</span><input name="min_score" type="number" min="0" max="1" step="0.05" inputMode="decimal" defaultValue={minimumScore ?? ""} placeholder="0.70" /></label>
          <label className="dashboard-field"><span>From</span><input name="from" type="date" defaultValue={from ?? ""} /></label>
          <label className="dashboard-field"><span>To</span><input name="to" type="date" defaultValue={to ?? ""} /></label>
          <div className="signal-filter-actions"><button className="dashboard-button dashboard-button-secondary" type="submit">Apply filters</button><Link className="dashboard-button dashboard-button-quiet" href="/app/signals">Clear</Link></div>
        </form>
      </details>
    </div>
  );
}
