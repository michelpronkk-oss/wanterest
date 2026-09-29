import { ConsoleShell, PageHeading, SourceStamp } from "@/components/console-shell";
import { requireAdminPermission } from "@/server/auth";
import { getOperationsSnapshot } from "@/server/operations";
import { getWebAnalyticsSnapshot } from "@/server/vercel-analytics";

export const dynamic = "force-dynamic";

const registeredProviders = ["fixture", "hacker-news", "bluesky", "reddit", "github", "x", "product-hunt", "stack-exchange", "public-web", "g2", "trustpilot", "youtube", "gitlab", "discourse", "devto"];
const pipelineStages = [
  ["Ingestion", "Provider adapters collect source items"],
  ["Canonicalize & deduplicate", "Raw payload to canonical conversation"],
  ["Filter & analyze", "Deterministic gates, then versioned analysis"],
  ["Match & rank", "Workspace-scoped evaluations and components"],
  ["Observe", "Evidence, map, gaps and drift"],
  ["Act & measure", "Actions, experiments and outcomes"],
] as const;

export default async function SystemMapPage() {
  const context = await requireAdminPermission("operations.summary.read");
  const [operations, analytics] = await Promise.all([getOperationsSnapshot(), getWebAnalyticsSnapshot()]);
  const observations = new Map((operations.sourceRows.value ?? []).map((source) => [source.sourceKey, source]));
  const latest = operations.trigger.runs?.[0] ?? null;
  return (
    <ConsoleShell context={context} active="/system-map">
      <PageHeading eyebrow="SYSTEM / DEPENDENCY MAP" title="A map of what runs." detail="Dependencies mirror the registered Wanterest source adapters and explicit analysis pipeline. Health is based on observations only." aside={<span className="range-control">Observed status · production</span>} />
      <section className="map-legend" aria-label="System map status legend"><span><i className="legend-dot healthy" />Healthy</span><span><i className="legend-dot degraded" />Degraded</span><span><i className="legend-dot critical" />Critical</span><span><i className="legend-dot disabled" />Intentionally disabled</span><span><i className="legend-dot stale" />Stale</span><span><i className="legend-dot unknown" />Unknown</span></section>
      <section className="panel system-map-panel" aria-labelledby="map-heading"><div className="panel-heading"><div><p className="eyebrow">REGISTERED FLOW</p><h2 id="map-heading">Source to measured outcome</h2></div><span className="panel-meta">Structure · code registry &amp; architecture</span></div>
        <div className="provider-region"><div className="map-column-heading"><span>01 / SOURCE PROVIDERS</span><small>15 registered adapters · status from source_health + source_controls</small></div><div className="provider-list">{registeredProviders.map((provider) => {
          const source = observations.get(provider);
          const state = source?.state ?? "unknown";
          return <div className={`map-node compact ${state}`} key={provider}><div className="map-node-top"><span className={`legend-dot ${state === "blocked" ? "critical" : state}`} /><strong>{provider}</strong></div><span>{mapStatus(state)}</span><small>{source ? `Checked ${formatDate(source.lastCheckedAt)}` : "No source observation"}</small></div>;
        })}</div></div>
        <div className="map-connector" aria-hidden="true"><span>↓</span><small>source items · provider provenance retained</small></div>
        <div className="pipeline-region"><div className="map-column-heading"><span>02 / EXPLICIT PIPELINE</span><small>Persisted jobs: {operations.jobs.value === null ? "unavailable" : `${operations.jobs.value} in last 24 hours`} · stage health is not independently probed</small></div><ol className="pipeline-list">{pipelineStages.map(([name, detail], index) => <li className="map-node pipeline-node unknown" key={name}><span className="pipeline-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{name}</strong><small>{detail}</small></div><span className="node-state">Unknown</span></li>)}</ol></div>
        <div className="map-connector" aria-hidden="true"><span>↓</span><small>evidence, stable relationships and immutable evaluations</small></div>
        <div className="map-services"><div className="map-column-heading"><span>03 / SYSTEM DEPENDENCIES</span><small>Current connections and durable health records</small></div><div className="service-grid">
          <ServiceNode name="Supabase production" detail="PostgreSQL system of record" status={operations.databaseRead === null ? "unknown" : operations.databaseRead ? "healthy" : "degraded"} observed={operations.databaseRead === null ? null : operations.checkedAt} />
          <ServiceNode name="Trigger.dev production" detail="Durable job execution · latest sampled runs" status={operations.trigger.state === "unavailable" ? "unknown" : operations.trigger.runs?.some((run) => ["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(run.status)) ? "degraded" : latest ? "healthy" : "unknown"} observed={operations.trigger.checkedAt} />
          <ServiceNode name="Vercel Web Analytics" detail="Visitor counts only · separate from lifecycle" status={analytics.state === "available" ? "healthy" : "unknown"} observed={analytics.refreshedAt} />
          <ServiceNode name="OpenAI LLM provider" detail="Configured behind the structured-generation adapter" status="unknown" observed={null} />
          <ServiceNode name="Dodo billing provider" detail="Normalized billing adapter · no live health probe" status="unknown" observed={null} />
          <ServiceNode name="Resend email provider" detail="Transactional email adapter · no live health probe" status="unknown" observed={null} />
          <ServiceNode name="Wanterest Admin" detail="Private Next.js application · MFA and membership gated" status="unknown" observed={null} />
        </div></div>
        <SourceStamp source="Code registry + Supabase production health + Trigger.dev + Vercel Analytics" range="Observations are shown independently; missing probes remain unknown" refreshedAt={operations.checkedAt} />
      </section>
      <p className="data-footnote">Green means the source returned a recent successful observation. Missing source rows, unknown pipeline probes, and unconfigured external reads are not treated as healthy.</p>
    </ConsoleShell>
  );
}

function ServiceNode({ name, detail, status, observed }: { name: string; detail: string; status: string; observed: string | null }) {
  return <article className={`map-node service-node ${status}`}><div className="map-node-top"><span className={`legend-dot ${status}`} /><strong>{name}</strong></div><p>{detail}</p><span>{mapStatus(status)}</span><small>{observed ? `Observed ${formatDate(observed)}` : "No observation"}</small></article>;
}
function mapStatus(state: string) { return ({ healthy: "Healthy", degraded: "Degraded", blocked: "Critical", critical: "Critical", disabled: "Intentionally disabled", paused: "Paused by control", stale: "Stale", unknown: "Unknown" } as Record<string, string>)[state] ?? "Unknown"; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Not observed"; }
