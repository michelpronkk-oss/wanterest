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
};

export function SignalFilters({ intentType, sourceKey, lifecycleStatus, minimumScore, from, to, sources }: Props) {
  return (
    <form className="signal-filters" method="get">
      <label className="dashboard-field"><span>Intent</span><select name="intent" defaultValue={intentType ?? ""}><option value="">All intents</option>{intentTypeSchema.options.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="dashboard-field"><span>Source</span><select name="source" defaultValue={sourceKey ?? ""}><option value="">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="dashboard-field"><span>Lifecycle</span><select name="status" defaultValue={lifecycleStatus ?? ""}><option value="">All statuses</option><option value="active">Active</option><option value="saved">Saved</option><option value="dismissed">Dismissed</option><option value="archived">Archived</option></select></label>
      <label className="dashboard-field"><span>Min score</span><input name="min_score" type="number" min="0" max="1" step="0.05" inputMode="decimal" defaultValue={minimumScore ?? ""} placeholder="0.70" /></label>
      <label className="dashboard-field"><span>From</span><input name="from" type="date" defaultValue={from ?? ""} /></label>
      <label className="dashboard-field"><span>To</span><input name="to" type="date" defaultValue={to ?? ""} /></label>
      <div className="signal-filter-actions"><button className="dashboard-button dashboard-button-secondary" type="submit">Apply filters</button><Link className="dashboard-button dashboard-button-quiet" href="/app/signals">Clear</Link></div>
    </form>
  );
}
