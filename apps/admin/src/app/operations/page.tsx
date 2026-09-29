import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { getOperationsSnapshot } from "@admin/server/operations";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const context = await requireAdminPermission("operations.read");
  const snapshot = await getOperationsSnapshot();
  const latestRoutingRun = snapshot.trigger.routingRuns?.[0] ?? null;
  const failedRoutingRuns = snapshot.trigger.routingRuns?.filter((run) => ["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(run.status)).length ?? null;
  return (
    <ConsoleShell context={context} active="/operations">
      <PageHeading eyebrow="OPERATIONS / LIVE SIGNALS" title="The work behind the signal." detail="Recent durable job records, production source observations and Trigger.dev execution state." aside={<span className="range-control">Rolling 24 hours · UTC</span>} />
      <section className="panel incident-panel" aria-labelledby="incident-heading">
        <div className="incident-header"><div><p className="eyebrow">ROUTING EDGE · KNOWN INCIDENT</p><h2 id="incident-heading">A recurring refresh conflict has been observed.</h2></div><span className="status-chip status-degraded">Historical failures</span></div>
        <p className="incident-copy">Previous production runs of <code>match-refreshed-partition</code> reported PostgreSQL <code>42P10</code> while upserting <code>product_routing_edges</code>. The deployed unique key includes <code>profile_version</code>; the reported conflict target omits it. This console is observational: no retries, replays or routing changes are issued here.</p>
        <div className="incident-facts"><div><span>Latest observed production run</span><strong>{latestRoutingRun ? latestRoutingRun.status.toLowerCase().replaceAll("_", " ") : "Unavailable"}</strong><small>{latestRoutingRun ? formatDate(latestRoutingRun.finishedAt ?? latestRoutingRun.createdAt) : "Trigger.dev read not connected"}</small></div><div><span>Failed runs · last 24 hours</span><strong>{failedRoutingRuns === null ? "Unavailable" : failedRoutingRuns}</strong><small>{snapshot.trigger.source}</small></div><div><span>Read timestamp</span><strong>{formatDate(snapshot.trigger.checkedAt)}</strong><small>Data remains unknown if the production read is not configured</small></div></div>
        <a className="text-link" href="https://cloud.trigger.dev/projects/proj_cxghokhenspxdbmgrczh" target="_blank" rel="noreferrer">Open Wanterest in Trigger.dev <span aria-hidden="true">↗</span></a>
      </section>

      <div className="operations-grid">
        <section className="panel" aria-labelledby="jobs-heading"><div className="panel-heading"><div><p className="eyebrow">DURABLE EXECUTION</p><h2 id="jobs-heading">Supabase job records</h2></div><span className="panel-meta">job_runs · trailing 24 hours</span></div>
          {snapshot.recentJobs.value === null ? <DataState state="unavailable" detail="Persisted job records could not be read." /> : snapshot.recentJobs.value.length === 0 ? <DataState state="empty" detail="No persisted jobs were created during this period." /> : <div className="job-list">{snapshot.recentJobs.value.map((job) => <div className="job-row operation-job" key={job.id}><span className={`job-indicator ${job.status}`} /><div className="job-name"><strong>{job.jobType}</strong><span>{job.id.slice(0, 8)} · trace {job.traceId}</span></div><span className={`job-status ${job.status}`}>{job.status.replaceAll("_", " ")}</span><div className="job-extra"><span>{job.attemptCount} attempt{job.attemptCount === 1 ? "" : "s"}</span>{job.errorCode && <code>{job.errorCode}</code>}<time>{formatDate(job.createdAt)}</time></div></div>)}</div>}
          <SourceStamp source={snapshot.recentJobs.source} range="Trailing 24 hours" refreshedAt={snapshot.checkedAt} />
        </section>
        <section className="panel" aria-labelledby="trigger-heading"><div className="panel-heading"><div><p className="eyebrow">ORCHESTRATION</p><h2 id="trigger-heading">Trigger.dev production</h2></div><span className={`pill ${snapshot.trigger.state}`}>{snapshot.trigger.state}</span></div>
          {snapshot.trigger.runs === null ? <DataState state="unavailable" detail="A production-scoped Trigger secret is required for this server-side run list." /> : snapshot.trigger.runs.length === 0 ? <DataState state="empty" detail="No match refresh runs were recorded in this period." /> : <div className="trigger-list">{snapshot.trigger.runs.map((run) => <div className="trigger-row" key={run.id}><span className={`job-indicator ${run.status.toLowerCase()}`} /><div><strong>{run.taskIdentifier}</strong><small>{run.id} · {run.version ? `worker ${run.version}` : "worker version not returned"}</small></div><span className={`job-status ${run.status.toLowerCase()}`}>{run.status.toLowerCase().replaceAll("_", " ")}</span><time>{formatDate(run.finishedAt ?? run.createdAt)}</time></div>)}</div>}
          <SourceStamp source={snapshot.trigger.source} range="All production tasks · trailing 24 hours" refreshedAt={snapshot.trigger.checkedAt} />
        </section>
      </div>

      <section className="panel source-health-panel" aria-labelledby="source-heading"><div className="panel-heading"><div><p className="eyebrow">PROVIDER OBSERVATIONS</p><h2 id="source-heading">Source health</h2></div><span className="panel-meta">source_health + source_controls · production</span></div>
        {snapshot.sourceRows.value === null ? <DataState state="unavailable" detail="Recorded source health could not be read." /> : snapshot.sourceRows.value.length === 0 ? <DataState state="empty" detail="No health rows are available; registered providers remain unobserved." /> : <div className="source-grid">{snapshot.sourceRows.value.map((source) => <article className="source-card" key={source.sourceKey}><div className="source-card-name"><span className={`source-indicator ${source.state}`} /><strong>{source.sourceKey}</strong></div><span className={`source-state ${source.state}`}>{displayState(source.state)}</span><small>Last checked · {formatDate(source.lastCheckedAt)}</small><small>Last success · {formatDate(source.lastSuccessAt)}</small><small>Last failure · {formatDate(source.lastFailureAt)}</small><small>Latency · {source.latencyMs === null ? "Not recorded" : `${source.latencyMs} ms`}{source.errorCode ? ` · ${source.errorCode}` : ""}</small>{source.failureCount !== null && source.failureCount > 0 && <small>{source.failureCount} consecutive source failure{source.failureCount === 1 ? "" : "s"}{source.nextRetryAt ? ` · retry ${formatDate(source.nextRetryAt)}` : ""}</small>}</article>)}</div>}
        <SourceStamp source="Supabase production · source_health + source_controls" range="Current recorded state · freshness threshold 24 hours" refreshedAt={snapshot.checkedAt} />
      </section>
      <p className="data-footnote">Error payloads and customer content are omitted. Trigger run output, retries and replays are not exposed as controls.</p>
    </ConsoleShell>
  );
}

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Not observed"; }
function displayState(value: string) { return ({ blocked: "Critical", degraded: "Degraded", disabled: "Intentionally disabled", paused: "Paused", stale: "Stale", unknown: "Unknown", healthy: "Healthy" } as Record<string, string>)[value] ?? "Unknown"; }
