import Link from "next/link";

import { SignalCard } from "@/components/dashboard/signal-card";
import { SignalFilters } from "@/components/dashboard/signal-filters";
import { SIGNALS_PAGE_SIZE } from "@/components/dashboard/dashboard-utils";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { intentTypeSchema, type SignalFilters as SignalFilterInput } from "@/server/modules/intelligence";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function boundedNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function boundedPage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : 0;
}

export default async function SignalsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getDashboardContext();
  const query = await searchParams;
  const intent = first(query.intent);
  const intentType = intentTypeSchema.safeParse(intent).success ? intent : undefined;
  const sourceKey = first(query.source)?.trim().slice(0, 120) || undefined;
  const lifecycle = first(query.status);
  const lifecycleStatus = lifecycle && ["active", "saved", "dismissed", "archived"].includes(lifecycle) ? lifecycle : undefined;
  const minimumScore = boundedNumber(first(query.min_score));
  const from = first(query.from);
  const to = first(query.to);
  const page = boundedPage(first(query.page));
  const filters: SignalFilterInput = {
    intentType,
    sourceKey,
    lifecycleStatus,
    minimumScore,
    from: from || undefined,
    to: to || undefined,
    limit: SIGNALS_PAGE_SIZE + 1,
    offset: page * SIGNALS_PAGE_SIZE,
  };

  if (!context.workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Signals</p><h1>Create a workspace first</h1><p>Signals are tenant-scoped and will appear here after an accessible workspace and product exist.</p><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }
  if (!context.product) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Signals</p><h1>Add a product first</h1><p>Signals are product-scoped. Add your first product to prepare the initial scan.</p><Link className="dashboard-button dashboard-button-primary" href="/app/setup/product">Add product</Link></section>;
  }

  const workspace = context.workspace;
  const product = context.product;
  const loadedSignals = await listSignalsQuery(workspace.id, product.id, filters);
  const hasNext = loadedSignals.length > SIGNALS_PAGE_SIZE;
  const signals = loadedSignals.slice(0, SIGNALS_PAGE_SIZE);
  const sources = [...new Set(loadedSignals.map((signal) => signal.source))].sort();
  const activeFilterCount = [intentType, sourceKey, lifecycleStatus, minimumScore, from, to].filter((value) => value !== undefined && value !== "").length;

  function pageUrl(nextPage: number): string {
    const params = new URLSearchParams();
    if (intentType) params.set("intent", intentType);
    if (sourceKey) params.set("source", sourceKey);
    if (lifecycleStatus) params.set("status", lifecycleStatus);
    if (minimumScore !== undefined) params.set("min_score", String(minimumScore));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (nextPage > 0) params.set("page", String(nextPage));
    const encoded = params.toString();
    return encoded ? `/app/signals?${encoded}` : "/app/signals";
  }

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header signals-header">
        <div>
          <p className="dashboard-eyebrow">Signals</p>
          <h1>Conversations with momentum.</h1>
          <p className="dashboard-subtitle">Ranked by the existing backend opportunity score for {product.name}. Inspect each result back to its source evidence before acting.</p>
        </div>
        <div className="signals-header-note"><span className="dashboard-status-dot" aria-hidden="true" />Bounded ranked read</div>
      </header>

      <SignalFilters intentType={intentType} sourceKey={sourceKey} lifecycleStatus={lifecycleStatus} minimumScore={first(query.min_score)} from={from} to={to} sources={sources} />

      <div className="signals-summary"><span>{signals.length ? `Showing ${signals.length} ranked signal${signals.length === 1 ? "" : "s"}` : "No matching signals"}</span>{activeFilterCount ? <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied</span> : <span>First page capped at {SIGNALS_PAGE_SIZE}</span>}</div>

      {signals.length === 0 ? (
        <div className="dashboard-panel dashboard-state">
          <p className="dashboard-eyebrow">Nothing to review</p>
          <h2>{activeFilterCount ? "No signals match these filters." : "No signals yet for this product."}</h2>
          <p>{activeFilterCount ? "Try widening the filters or return to the full ranked feed." : "Once ingestion and intelligence processing produce a qualified result, it will appear here with its evidence trail."}</p>
          {activeFilterCount ? <Link className="dashboard-button dashboard-button-secondary" href="/app/signals">Clear filters</Link> : null}
        </div>
      ) : (
        <div className="signal-list" aria-label="Ranked signals">
          {signals.map((signal) => <SignalCard key={signal.signalId} signal={signal} workspaceId={workspace.id} />)}
        </div>
      )}

      {(page > 0 || hasNext) ? <nav className="signals-pagination" aria-label="Signals pagination"><span>Page {page + 1}</span>{page > 0 ? <Link className="dashboard-button dashboard-button-secondary" href={pageUrl(page - 1)}>Previous</Link> : <span />}{hasNext ? <Link className="dashboard-button dashboard-button-secondary" href={pageUrl(page + 1)}>Next</Link> : <span />}</nav> : null}
    </section>
  );
}
