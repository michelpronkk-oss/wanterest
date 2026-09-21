import Link from "next/link";

import { SignalList } from "@/components/dashboard/signal-list";
import { SignalFilters } from "@/components/dashboard/signal-filters";
import { SIGNALS_PAGE_SIZE } from "@/components/dashboard/dashboard-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { ZeroState } from "@/components/ui/zero-state";
import { SignalGhostPreview } from "@/components/dashboard/signal-ghost-preview";
import { ScanStatusBanner } from "@/components/dashboard/scan-status-banner";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { intentTypeSchema, type SignalFilters as SignalFilterInput } from "@/server/modules/intelligence";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";
import { getProductScanState } from "@/components/dashboard/scan-state";
import { scanResultEmptyBody } from "@/components/dashboard/scan-status.view-model";

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
  const textQuery = first(query.q)?.trim().slice(0, 200) || undefined;
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
    return (
      <section className="dashboard-page">
        <ZeroState
          eyebrow="Signals"
          title="Find qualified conversations where real demand is showing up."
          body="Add your product and Wanterest will begin discovering and qualifying relevant public conversations across the sources that matter to your market."
          primaryCta={{ label: "Add product", href: "/app/setup/product" }}
        />
        <div style={{ marginTop: 32, maxWidth: 640 }}>
          <p className="ui-section-label">What a signal looks like</p>
          <SignalGhostPreview count={3} />
        </div>
      </section>
    );
  }

  const workspace = context.workspace;
  const product = context.product;
  const loadedSignals = await listSignalsQuery(workspace.id, product.id, filters);
  const hasNext = loadedSignals.length > SIGNALS_PAGE_SIZE;
  let signals = loadedSignals.slice(0, SIGNALS_PAGE_SIZE);
  if (textQuery) {
    const needle = textQuery.toLowerCase();
    signals = signals.filter((signal) => signal.excerpt.toLowerCase().includes(needle) || signal.whyItMatters.toLowerCase().includes(needle));
  }
  const sources = [...new Set(loadedSignals.map((signal) => signal.source))].sort();
  const activeFilterCount = [intentType, sourceKey, lifecycleStatus, minimumScore, from, to, textQuery].filter((value) => value !== undefined && value !== "").length;
  const scanState = activeFilterCount === 0 ? await getProductScanState(workspace.id, product.id, loadedSignals.length > 0) : null;

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header signals-header">
        <p className="dashboard-eyebrow">Signals</p>
        <h1>Signals</h1>
        <p className="dashboard-subtitle">Qualified conversations where real demand is showing up for {product.name}.</p>
      </header>

      {scanState ? <ScanStatusBanner state={scanState} workspaceId={workspace.id} productId={product.id} /> : null}

      <SignalFilters intentType={intentType} sourceKey={sourceKey} lifecycleStatus={lifecycleStatus} minimumScore={first(query.min_score)} from={from} to={to} sources={sources} query={textQuery} />

      <div className="signals-summary"><span>{signals.length ? `Showing ${signals.length} ranked signal${signals.length === 1 ? "" : "s"}` : "No matching signals"}</span>{activeFilterCount ? <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied</span> : <span>First page capped at {SIGNALS_PAGE_SIZE}</span>}</div>

      {signals.length === 0 ? (
        activeFilterCount > 0 ? (
          <EmptyState
            title="No signals match these filters"
            body="Try widening your filters, or check back after your next scan."
            cta={{ label: "Clear filters", href: "/app/signals" }}
          />
        ) : scanState?.kind === "no_scan" ? (
          <>
            <ZeroState
              eyebrow="Signals"
              title="Start your first demand scan."
              body="Wanterest hasn't looked for demand yet. Start your first scan to begin discovering and qualifying real conversations for this product."
              primaryCta={{ label: "Start first scan", href: "/app/setup/scan" }}
            />
            <div style={{ marginTop: 32, maxWidth: 640 }}>
              <p className="ui-section-label">What a signal looks like</p>
              <SignalGhostPreview count={3} />
            </div>
          </>
        ) : scanState?.kind === "running" ? (
          <EmptyState title="Finding qualified demand" body="Signals will appear here as soon as Wanterest finishes qualifying this scan." />
        ) : scanState?.kind === "failed" ? (
          <EmptyState title="The last scan couldn't finish" body={scanState.message ?? "Try running the scan again."} cta={{ label: "Try again", href: "/app/setup/scan" }} />
        ) : (
          <EmptyState
            title={scanState?.summary ? "No high-confidence demand found in this scan" : "No qualified demand found yet"}
            body={scanState?.summary ? scanResultEmptyBody(scanState.summary) : "Wanterest filtered out weak or irrelevant conversations from this scan. Qualified signals will appear here as they're found."}
            cta={{ label: "Run another scan", href: "/app/setup/scan" }}
          />
        )
      ) : (
        <SignalList signals={signals} workspaceId={workspace.id} />
      )}

      {(page > 0 || hasNext) ? (
        <nav className="signals-pagination" aria-label="Signals pagination">
          <span>Page {page + 1}</span>
          {page > 0 ? <Link className="dashboard-button dashboard-button-secondary" href={pageUrl(page - 1, { intentType, sourceKey, lifecycleStatus, minimumScore, from, to })}>Previous</Link> : <span />}
          {hasNext ? <Link className="dashboard-button dashboard-button-secondary" href={pageUrl(page + 1, { intentType, sourceKey, lifecycleStatus, minimumScore, from, to })}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function pageUrl(nextPage: number, filters: { intentType?: string; sourceKey?: string; lifecycleStatus?: string; minimumScore?: number; from?: string; to?: string }): string {
  const params = new URLSearchParams();
  if (filters.intentType) params.set("intent", filters.intentType);
  if (filters.sourceKey) params.set("source", filters.sourceKey);
  if (filters.lifecycleStatus) params.set("status", filters.lifecycleStatus);
  if (filters.minimumScore !== undefined) params.set("min_score", String(filters.minimumScore));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (nextPage > 0) params.set("page", String(nextPage));
  const encoded = params.toString();
  return encoded ? `/app/signals?${encoded}` : "/app/signals";
}
