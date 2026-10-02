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
      <PageHeading eyebrow="OPERATIONS / LIVE SIGNALS" title="The work behind the signal." detail="Recent durable job records, provider execution attribution, source observations and Trigger.dev state." aside={<span className="range-control">Rolling 24 hours · UTC</span>} />

      <section className="panel incident-panel" aria-labelledby="incident-heading">
        <div className="incident-header"><div><p className="eyebrow">ROUTING EDGE · KNOWN INCIDENT</p><h2 id="incident-heading">A recurring refresh conflict has been observed.</h2></div><span className="status-chip status-degraded">Historical failures</span></div>
        <p className="incident-copy">Previous production runs of <code>match-refreshed-partition</code> reported PostgreSQL <code>42P10</code> while upserting <code>product_routing_edges</code>. The deployed unique key includes <code>profile_version</code>; the reported conflict target omits it. The routing shadow is observational: this console issues no retries, replays or routing changes.</p>
        <div className="incident-facts"><div><span>Latest observed production run</span><strong>{latestRoutingRun ? latestRoutingRun.status.toLowerCase().replaceAll("_", " ") : "Unavailable"}</strong><small>{latestRoutingRun ? formatDate(latestRoutingRun.finishedAt ?? latestRoutingRun.createdAt) : "Trigger.dev read not connected"}</small></div><div><span>Failed runs · last 24 hours</span><strong>{failedRoutingRuns === null ? "Unavailable" : formatNumber(failedRoutingRuns)}</strong><small>{snapshot.trigger.source}</small></div><div><span>Read timestamp</span><strong>{formatDate(snapshot.trigger.checkedAt)}</strong><small>Unknown when the production read is not configured</small></div></div>
        <a className="text-link" href="https://cloud.trigger.dev/projects/proj_cxghokhenspxdbmgrczh" target="_blank" rel="noreferrer">Open Wanterest in Trigger.dev <span aria-hidden="true">↗</span></a>
      </section>

      <section className="panel operations-measurement" aria-labelledby="query-novelty-heading">
        <div className="panel-heading"><div><p className="eyebrow">QUERY EXPLORATION V1 / V1.1</p><h2 id="query-novelty-heading">Novelty and selection by provider</h2></div><span className="panel-meta">Private aggregates · trailing 7 days</span></div>
        {snapshot.pipelineState === "disabled" ? <DataState state="unavailable" detail="Server-side source execution telemetry is disabled. Query novelty is not being read or written." /> : snapshot.queryNovelty.value === null ? <DataState state="unavailable" detail="Query novelty history could not be read or validated. Counts remain unavailable." /> : snapshot.queryNovelty.value.executions === 0 ? <DataState state="empty" detail="No query execution history is recorded in this period." /> : <>
          <div className="ops-stat-grid ops-stat-grid-six" aria-label="Query novelty summary">
            <Stat label="Executions" value={snapshot.queryNovelty.value.executions} detail="Persisted query attempts" />
            <Stat label="Providers" value={snapshot.queryNovelty.value.sources.length} detail="Providers with attributed rows" />
            <Stat label="Intent families" value={snapshot.queryNovelty.value.intentFamilies.length} detail="Profile-supported taxonomy labels" />
            <Stat label="Independent roots" value={snapshot.queryNovelty.value.independentRoots} detail="Unique roots summed per product scan in this window" />
            <Stat label="New independent roots" value={snapshot.queryNovelty.value.firstSeenRoots} detail="First-seen in bounded 90-day product history" />
            <Stat label="New eligible independent roots" value={snapshot.queryNovelty.value.newIndependentEvidenceEligibleRoots} detail="First-seen roots that survived unchanged evidence filters" />
            <Stat label="New root attributions" value={snapshot.queryNovelty.value.newRootAttributions} detail="New within 90-day history; may repeat across queries" />
            <Stat label="Prior / same-scan repeats" value={`${formatNumber(snapshot.queryNovelty.value.repeatedRoots)} / ${formatNumber(snapshot.queryNovelty.value.sameScanDuplicates)}`} detail="Previously seen in 90 days / multi-query attribution" />
            <Stat label="Evidence-eligible / known" value={`${formatNumber(snapshot.queryNovelty.value.evidenceEligibleRoots)} / ${formatNumber(snapshot.queryNovelty.value.evidenceEligibilityKnownRoots)}`} detail="Evidence-filter survival on known roots" />
            <Stat label="Evaluated / qualified" value={`${formatNumber(snapshot.queryNovelty.value.evaluatedRoots)} / ${formatNumber(snapshot.queryNovelty.value.qualifiedRoots)}`} detail="Qualification outcomes on evaluated roots" />
            <Stat label="New independent qualified roots" value={snapshot.queryNovelty.value.newIndependentQualifiedRoots} detail="First-seen roots that qualified in this window" />
            <Stat label="New root rate" value={formatRate(snapshot.queryNovelty.value.newRootRate)} detail="First-seen within 90 days / attributable results" />
            <Stat label="Eligible root rate" value={formatRate(snapshot.queryNovelty.value.eligibleRootRate)} detail="Evidence-eligible / known roots" />
            <Stat label="Qualified root rate" value={formatRate(snapshot.queryNovelty.value.qualifiedRootRate)} detail="Qualified / evaluated roots" />
          </div>
          {snapshot.queryNovelty.value.truncated && <p className="ops-measurement-note ops-novelty-truncated" role="status">This is a bounded recent sample. The private history read reached its 1,000 product-scan limit, so older scan records are not included in these aggregates.</p>}
          <div className="ops-provider-list ops-novelty-list">
            {snapshot.queryNovelty.value.buckets.slice(0, 16).map((bucket) => <article className="ops-provider" key={`${bucket.sourceKey}:${bucket.intentFamily}:${bucket.variantVersion}:${bucket.selectionReason ?? "unrecorded"}:${bucket.noveltyState ?? "unrecorded"}`}>
              <div className="ops-provider-heading"><h3>{bucket.sourceKey} · {bucket.intentFamily.replaceAll("_", " ")}</h3><span>{bucket.variantVersion.replaceAll("_", " ")}</span></div>
              <dl className="ops-provider-stats">
                <Metric label="Selection reason" value={bucket.selectionReason?.replaceAll("_", " ") ?? "Not recorded"} />
                <Metric label="Novelty state" value={bucket.noveltyState?.replaceAll("_", " ") ?? "Not recorded"} />
                <Metric label="Executions" value={bucket.executions} />
                <Metric label="Provider results" value={bucket.providerResults} />
                <Metric label="Raw snapshots inserted" value={bucket.rawSnapshotsInserted} />
                <Metric label="Previously seen raw snapshots" value={bucket.rawSnapshotsDuplicate} />
                <Metric label="Unique provider items" value={bucket.uniqueProviderItems} />
                <Metric label="Normalized items" value={bucket.normalizedItems} />
                <Metric label="Attributable results" value={bucket.attributableResults} />
                <Metric label="Root attributions" value={bucket.rootAttributions} />
                <Metric label="Independent roots" value={bucket.independentRoots} />
                <Metric label="New within 90-day history" value={bucket.newRootAttributions} />
                <Metric label="First-seen roots" value={bucket.firstSeenRoots} />
                <Metric label="First-seen evidence-eligible roots" value={bucket.newIndependentEvidenceEligibleRoots} />
                <Metric label="Prior / same-scan repeats" value={`${formatNumber(bucket.repeatedRoots)} / ${formatNumber(bucket.sameScanDuplicates)}`} />
                <Metric label="Evidence-eligible independent roots" value={bucket.evidenceEligibilityKnownRoots === 0 ? "Not observed" : `${formatNumber(bucket.evidenceEligibleRoots)} / ${formatNumber(bucket.evidenceEligibilityKnownRoots)} known`} />
                <Metric label="Evaluated / qualified independent roots" value={`${formatNumber(bucket.evaluatedRoots)} / ${formatNumber(bucket.qualifiedRoots)}`} />
                <Metric label="New independent qualified roots" value={bucket.newIndependentQualifiedRoots} />
                <Metric label="New root rate" value={formatRate(bucket.newRootRate)} />
                <Metric label="Eligible root rate" value={formatRate(bucket.eligibleRootRate)} />
                <Metric label="Qualified root rate" value={formatRate(bucket.qualifiedRootRate)} />
                <Metric label="Signals" value={bucket.signals} />
              </dl>
            </article>)}
          </div>
          <p className="ops-measurement-note">First-seen roots are assigned once per product scan. New root attributions can include one root returned by multiple queries; query IDs, fingerprints and search text are not shown. Query executions: {formatDate(snapshot.queryNovelty.value.rangeStart)} – {formatDate(snapshot.queryNovelty.value.rangeEnd)} · latest observed {formatDate(snapshot.queryNovelty.value.latestExecutionAt)}.</p>
        </>}
        <SourceStamp source={snapshot.queryNovelty.source} range="Trailing 7 days · up to 12 scans per product · bounded private RPC" refreshedAt={snapshot.checkedAt} />
      </section>

      <section className="panel operations-measurement" aria-labelledby="v11-diagnostics-heading">
        <div className="panel-heading"><div><p className="eyebrow">BOUNDED PLANNER EXPLORATION</p><h2 id="v11-diagnostics-heading">V1.1 candidate rotation</h2></div><span className="panel-meta">Latest completed scan · count-only read</span></div>
        {snapshot.queryExplorationState === "disabled" ? <DataState state="unavailable" detail="Source execution observability is disabled. No planner candidate diagnostics are being read." />
          : snapshot.queryExplorationState === "unavailable" ? <DataState state="unavailable" detail="The latest bounded planner diagnostics could not be read or validated." />
            : snapshot.queryExploration.value === null ? <DataState state="empty" detail="No completed V1.1 planner result was observed in the trailing seven days." /> : <>
              <div className="ops-stat-grid ops-stat-grid-six" aria-label="V1.1 planner exploration counts">
                <Stat label="Valid candidates" value={snapshot.queryExploration.value.candidateCount} detail="Existing V8 candidate pool only" />
                <Stat label="Unselected candidates" value={snapshot.queryExploration.value.unselectedCandidateCount} detail="Valid pool members outside current slots" />
                <Stat label="Recently executed candidates" value={snapshot.queryExploration.value.recentlyExecutedCandidateCount} detail="Fingerprint observed within the seven-day freshness window" />
                <Stat label="Previously executed" value={snapshot.queryExploration.value.previouslyExecutedCandidateCount} detail="Known V1 or V1.1 fingerprints" />
                <Stat label="Unseen candidates" value={snapshot.queryExploration.value.unseenCandidateCount} detail="No matching V1/V1.1 execution history" />
                <Stat label="Rotated selections" value={snapshot.queryExploration.value.rotatedSelectionCount} detail="Selected outside the V1 slot baseline" />
                <Stat label="Immediate repeats" value={snapshot.queryExploration.value.immediatelyRepeatedSelectionCount} detail={`Selected from the latest provider scan; ${formatNumber(snapshot.queryExploration.value.immediatelyRepeatedCandidateCount)} candidates had immediate history`} />
                <Stat label="Persistent low-novelty candidates" value={snapshot.queryExploration.value.persistentLowNoveltyCandidateCount} detail="Conservative multi-run signal; candidates remain selectable" />
                <Stat label="Recent zero-root candidates" value={snapshot.queryExploration.value.recentZeroNoveltyCandidateCount} detail="Temporary rotation signal after a successful run with roots but no new independent roots" />
                <Stat label="Query slots" value={`${snapshot.queryExploration.value.queryCountAfter} / ${snapshot.queryExploration.value.queryCountBefore}`} detail="Before / after V1.1; slot count must stay equal" />
              </div>
              <div className="ops-provider-list ops-novelty-list">
                {snapshot.queryExploration.value.candidatePoolBySource.map((provider) => <article className="ops-provider" key={provider.sourceKey}>
                  <div className="ops-provider-heading"><h3>{provider.sourceKey}</h3><span>{provider.validCandidates} valid candidates</span></div>
                  <dl className="ops-provider-stats">
                    <Metric label="Selected / unselected" value={`${formatNumber(provider.selected)} / ${formatNumber(provider.unselected)}`} />
                    <Metric label="Selected intent families" value={snapshot.queryExploration.value!.familyCoverageBySource.find((row) => row.sourceKey === provider.sourceKey)?.families ?? "Not observed"} />
                    <Metric label="Candidates covered 0 / 1 / 2 / 3+ recent scans" value={(() => {
                      const coverage = snapshot.queryExploration.value!.familyCoverageHistoryBySource.find((row) => row.sourceKey === provider.sourceKey);
                      return coverage ? `${coverage.zeroScansCandidates} / ${coverage.oneScanCandidates} / ${coverage.twoScansCandidates} / ${coverage.threeScansCandidates}` : "Not observed";
                    })()} />
                  </dl>
                </article>)}
              </div>
              <p className="ops-measurement-note">Selection reasons: {snapshot.queryExploration.value.selectedReasonCounts.length ? snapshot.queryExploration.value.selectedReasonCounts.map(({ reason, count }) => `${reason.replaceAll("_", " ")} ${formatNumber(count)}`).join(" · ") : "None recorded"}. Candidate history: {snapshot.queryExploration.value.noveltyStateCounts.length ? snapshot.queryExploration.value.noveltyStateCounts.map(({ state, count }) => `${state.replaceAll("_", " ")} ${formatNumber(count)}`).join(" · ") : "None recorded"}. The projection excludes query text, query IDs, fingerprints and provider content.</p>
              <p className="ops-measurement-note">Latest V1.1 scan completed {formatDate(snapshot.queryExploration.value.completedAt)} · selected {formatNumber(snapshot.queryExploration.value.queryCountAfter)} of {formatNumber(snapshot.queryExploration.value.queryCountBefore)} planned slots.</p>
            </>}
        <SourceStamp source={snapshot.queryExploration.source} range="Latest 12 successful scans · trailing 7 days · bounded aggregate projection" refreshedAt={snapshot.checkedAt} />
      </section>

      <section className="panel operations-measurement" aria-labelledby="measurement-heading">
        <div className="panel-heading"><div><p className="eyebrow">QUERY → ROOT → QUALIFICATION</p><h2 id="measurement-heading">Provider execution yield</h2></div><span className="panel-meta">Attributed records · trailing 7 days</span></div>
        {snapshot.pipelineState === "disabled" ? <DataState state="unavailable" detail="Server-side source execution telemetry is disabled. No query, page or outcome attribution is being read or written." /> : snapshot.pipeline.value === null ? <DataState state="unavailable" detail="Query, page or product outcome attribution could not be read. Metrics remain unavailable until every required source is readable." /> : snapshot.pipeline.value.providers.length === 0 ? <DataState state="empty" detail="No provider execution attribution has been recorded in this period." /> : <>
          <div className="ops-stat-grid" aria-label="Attributed totals">
            <Stat label="Independent roots" value={snapshot.pipeline.value.roots} detail="Distinct canonical conversations across recorded provider results" />
            <Stat label="Qualified roots" value={snapshot.pipeline.value.qualifiedRoots} detail="Distinct roots with a linked qualified product evaluation" />
            <Stat label="Providers observed" value={snapshot.pipeline.value.providers.length} detail="Providers with query plans or execution records" />
          </div>
          <div className="ops-provider-list">
            {snapshot.pipeline.value.providers.map((provider) => <article className="ops-provider" key={provider.sourceKey}>
              <div className="ops-provider-heading"><h3>{provider.sourceKey}</h3><span>{formatNumber(provider.executions)} actual executions</span></div>
              <dl className="ops-provider-stats">
                <Metric label="Planned query records" value={provider.plannedQueries} />
                <Metric label="Queries executed" value={provider.executedQueries} />
                <Metric label="Successful executions" value={provider.successful} />
                <Metric label="Failed executions" value={provider.failed} />
                <Metric label="Rate-limited executions" value={provider.rateLimitedExecutions} />
                <Metric label="Skipped query records" value={provider.skippedQueries} />
                <Metric label="Provider results" value={provider.providerResults} />
                <Metric label="New raw snapshots" value={provider.rawSnapshotsInserted} />
                <Metric label="Unique roots" value={provider.uniqueRoots} />
                <Metric label="Duplicate root observations" value={provider.duplicateRoots} />
                <Metric label="Qualified roots" value={provider.qualifiedRoots} />
                <Metric label="Pages / continuations" value={`${formatNumber(provider.pages)} / ${formatNumber(provider.continuations)}`} />
                <Metric label="Retries" value={provider.retries} />
                <Metric label="Lowest rate-limit remaining" value={provider.lowestRateLimitRemaining === null ? "Not recorded" : provider.lowestRateLimitRemaining} />
                <Metric label="Longest retry-after hint" value={provider.longestRetryAfterHintMs === null ? "Not recorded" : `${formatNumber(provider.longestRetryAfterHintMs)} ms`} />
                <Metric label="Average runtime" value={provider.averageRuntimeMs === null ? "Not recorded" : `${formatNumber(provider.averageRuntimeMs)} ms`} />
              </dl>
            </article>)}
          </div>
          <p className="ops-measurement-note">Planned query records come from persisted initial-scan query artifacts. Executions and pages come from provider-call telemetry. Qualified roots are canonical conversation IDs linked to product evaluations; they are not visitor analytics or a cross-product qualification rate.</p>
        </>}
        <SourceStamp source={snapshot.pipeline.source} range="Trailing 7 days · UTC" refreshedAt={snapshot.checkedAt} />
        <div className="ops-continuation" aria-labelledby="pagination-heading">
          <div className="panel-heading"><div><p className="eyebrow">ADAPTIVE DEPTH · COUNTS ONLY</p><h3 id="pagination-heading">Pagination V1 continuation yield</h3></div><span className="panel-meta">Trailing 7 days</span></div>
          {snapshot.paginationState === "disabled" ? <DataState state="unavailable" detail="Source execution telemetry is disabled, so continuation activity is not being read." />
            : snapshot.paginationState === "unavailable" ? <DataState state="unavailable" detail="Pagination V1 decision telemetry is unavailable. Existing provider execution metrics remain separate." />
              : snapshot.paginationState === "empty" ? <DataState state="empty" detail="No Pagination V1 page decisions were recorded in this period." />
                : snapshot.pagination.value === null ? <DataState state="unavailable" detail="Pagination V1 telemetry could not be reconciled." /> : <>
                  <div className="ops-stat-grid" aria-label="Pagination continuation totals">
                    <Stat label="Base requests" value={snapshot.pagination.value.baseRequests} detail="One selected provider query, page one" />
                    <Stat label="Eligible queries" value={snapshot.pagination.value.eligible} detail="Passed the first-page novelty gate" />
                    <Stat label="Provider requests" value={snapshot.pagination.value.baseRequests + snapshot.pagination.value.continuationRequests} detail={`${snapshot.pagination.value.baseRequests} base + ${snapshot.pagination.value.continuationRequests} continuation`} />
                    <Stat label="Continuation failures" value={snapshot.pagination.value.failures} detail="Optional page-two requests only" />
                    <Stat label="Continuation results" value={snapshot.pagination.value.results} detail="Provider-returned page-two results" />
                    <Stat label="New / repeated provider items" value={`${formatNumber(snapshot.pagination.value.uniqueProviderItems)} / ${formatNumber(snapshot.pagination.value.duplicateProviderItems)}`} detail="Unique native items / page-two repeats within the query" />
                    <Stat label="New / reused raw" value={`${formatNumber(snapshot.pagination.value.inserted)} / ${formatNumber(snapshot.pagination.value.reused)}`} detail="Persisted / already-known raw snapshots" />
                    <Stat label="Independent roots" value={snapshot.pagination.value.independentRoots} detail="First attributed on page two within the query execution" />
                    <Stat label="Repeated root attributions" value={snapshot.pagination.value.repeatedRootAttributions} detail="Page-two roots already seen on page one or repeated there" />
                    <Stat label="Evidence-eligible roots" value={`${formatNumber(snapshot.pagination.value.evidenceEligibleRoots)} / ${formatNumber(snapshot.pagination.value.evidenceEligibilityKnownRoots)} known`} detail="Unknown outcome rows are not counted as ineligible" />
                    <Stat label="First-seen eligible roots" value={snapshot.pagination.value.firstSeenEvidenceEligibleRoots} detail="Eligible roots first attributed on page two in that query" />
                  </div>
                  <div className="ops-provider-list">
                    {snapshot.pagination.value.providers.map((provider) => <article className="ops-provider" key={provider.sourceKey}>
                      <div className="ops-provider-heading"><h4>{provider.sourceKey}</h4><span>{formatNumber(provider.continuationRequests)} continuation requests</span></div>
                      <dl className="ops-provider-stats">
                        <Metric label="Base / eligible / attempted" value={`${provider.baseRequests} / ${provider.eligible} / ${provider.attempted}`} />
                        <Metric label="Failures" value={provider.failures} />
                        <Metric label="Results / inserted / reused" value={`${provider.results} / ${provider.inserted} / ${provider.reused}`} />
                        <Metric label="New roots / repeated attributions" value={`${provider.firstSeenRootsInExecution} / ${provider.repeatedRootAttributions}`} />
                        <Metric label="Eligible / known outcomes" value={`${provider.evidenceEligibleRoots} / ${provider.evidenceEligibilityKnownRoots}`} />
                        <Metric label="First-seen eligible roots" value={provider.firstSeenEvidenceEligibleRoots} />
                        <Metric label="Novel root yield / continuation" value={provider.continuationRequests ? `${(provider.firstSeenRootsInExecution / provider.continuationRequests).toFixed(2)}` : "Not applicable"} />
                      </dl>
                    </article>)}
                  </div>
                  <p className="ops-measurement-note">Continuation decisions: {snapshot.pagination.value.decisionReasons.length ? snapshot.pagination.value.decisionReasons.map(({ reason, count }) => `${reason.replaceAll("_", " ")} ${formatNumber(count)}`).join(" · ") : "None recorded"}. Page-two outcomes: {Object.entries(snapshot.pagination.value.continuationStatuses).map(([status, count]) => `${status.replaceAll("_", " ")} ${formatNumber(count)}`).join(" · ") || "None recorded"}.</p>
                  <p className="ops-measurement-note">“First-seen” here means first attributed within that provider-query execution, not first observed across production history. Query text, cursors, payloads, author data and product context are not projected.</p>
                </>}
          <SourceStamp source={snapshot.pagination.source} range="Pagination V1 pages and linked outcomes · trailing 7 days · UTC" refreshedAt={snapshot.checkedAt} />
        </div>
      </section>

      <div className="operations-grid">
        <section className="panel" aria-labelledby="stuck-heading"><div className="panel-heading"><div><p className="eyebrow">NEEDS ATTENTION</p><h2 id="stuck-heading">Long-running job records</h2></div><span className="panel-meta">job_runs · running · older than 30 minutes</span></div>
          {snapshot.stuckJobs.value === null ? <DataState state="unavailable" detail="Long-running job records could not be read." /> : snapshot.stuckJobs.value.length === 0 ? <DataState state="empty" detail="No running job records older than 30 minutes were observed." /> : <>
            <p className="ops-attention-count">{snapshot.stuckJobCount.value === null ? "Count unavailable" : `${formatNumber(snapshot.stuckJobCount.value)} running job${snapshot.stuckJobCount.value === 1 ? "" : "s"} older than 30 minutes`}</p>
            <div className="job-list">{snapshot.stuckJobs.value.map((job) => <div className="job-row operation-job" key={job.id}><span className="job-indicator running" /><div className="job-name"><strong>{job.jobType}</strong><span>{job.id.slice(0, 8)}</span></div><span className="job-status running">running</span><div className="job-extra"><span>{job.attemptCount} attempt{job.attemptCount === 1 ? "" : "s"}</span>{job.errorCode && <code>{job.errorCode}</code>}<time>{formatDate(job.startedAt ?? job.createdAt)}</time></div></div>)}</div>
          </>}
          <SourceStamp source={snapshot.stuckJobs.source} range="Running job rows older than 30 minutes" refreshedAt={snapshot.checkedAt} />
        </section>
        <section className="panel" aria-labelledby="monitoring-heading"><div className="panel-heading"><div><p className="eyebrow">PRODUCT POLICY</p><h2 id="monitoring-heading">Monitoring schedules</h2></div><span className="panel-meta">monitoring_schedules · current recorded state</span></div>
          {snapshot.monitoring.value === null ? <DataState state="unavailable" detail="Monitoring schedule state could not be read." /> : <>
            <div className="ops-stat-grid ops-stat-grid-two"><Stat label="Enabled" value={snapshot.monitoring.value.enabledSchedules} detail="Schedules currently enabled" /><Stat label="Disabled" value={snapshot.monitoring.value.disabledSchedules} detail="Schedules currently disabled" /></div>
            {Object.keys(snapshot.monitoring.value.statusCounts).length ? <ul className="ops-status-list">{Object.entries(snapshot.monitoring.value.statusCounts).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => <li key={status}><span>{status.replaceAll("_", " ")}</span><strong>{formatNumber(count)}</strong></li>)}</ul> : <DataState state="empty" detail="No monitoring schedule rows are recorded." />}
            <p className="ops-monitor-dates">Last cycle · {formatDate(snapshot.monitoring.value.lastCycleAt)}<br />Last success · {formatDate(snapshot.monitoring.value.lastSuccessAt)}<br />Last failure · {formatDate(snapshot.monitoring.value.lastFailureAt)}</p>
          </>}
          <SourceStamp source={snapshot.monitoring.source} range="Current recorded schedule state" refreshedAt={snapshot.checkedAt} />
        </section>
      </div>

      <div className="operations-grid">
        <section className="panel" aria-labelledby="jobs-heading"><div className="panel-heading"><div><p className="eyebrow">DURABLE EXECUTION</p><h2 id="jobs-heading">Supabase job records</h2></div><span className="panel-meta">job_runs · trailing 24 hours</span></div>
          {snapshot.recentJobs.value === null ? <DataState state="unavailable" detail="Persisted job records could not be read." /> : snapshot.recentJobs.value.length === 0 ? <DataState state="empty" detail="No persisted jobs were created during this period." /> : <div className="job-list">{snapshot.recentJobs.value.map((job) => <div className="job-row operation-job" key={job.id}><span className={`job-indicator ${job.status}`} /><div className="job-name"><strong>{job.jobType}</strong><span>{job.id.slice(0, 8)} · trace {job.traceId}</span></div><span className={`job-status ${job.status}`}>{job.status.replaceAll("_", " ")}</span><div className="job-extra"><span>{job.attemptCount} attempt{job.attemptCount === 1 ? "" : "s"}</span>{job.errorCode && <code>{job.errorCode}</code>}<time>{formatDate(job.createdAt)}</time></div></div>)}</div>}
          <SourceStamp source={snapshot.recentJobs.source} range="Trailing 24 hours" refreshedAt={snapshot.checkedAt} />
        </section>
        <section className="panel" aria-labelledby="trigger-heading"><div className="panel-heading"><div><p className="eyebrow">ORCHESTRATION</p><h2 id="trigger-heading">Trigger.dev production</h2></div><span className={`pill ${snapshot.trigger.state}`}>{snapshot.trigger.state}</span></div>
          {snapshot.trigger.runs === null ? <DataState state="unavailable" detail="A production-scoped Trigger secret is required for this server-side run list." /> : snapshot.trigger.runs.length === 0 ? <DataState state="empty" detail="No match refresh runs were recorded in this period." /> : <div className="trigger-list">{snapshot.trigger.runs.map((run) => <div className="trigger-row" key={run.id}><span className={`job-indicator ${run.status.toLowerCase()}`} /><div><strong>{run.taskIdentifier}</strong><small>{run.id} · {run.version ? `worker ${run.version}` : "worker version not returned"}</small></div><span className={`job-status ${run.status.toLowerCase()}`}>{run.status.toLowerCase().replaceAll("_", " ")}</span><time>{formatDate(run.finishedAt ?? run.createdAt)}</time></div>)}</div>}
          <SourceStamp source={snapshot.trigger.source} range="Production task runs · trailing 24 hours" refreshedAt={snapshot.trigger.checkedAt} />
        </section>
      </div>

      <section className="panel source-health-panel" aria-labelledby="source-heading"><div className="panel-heading"><div><p className="eyebrow">PROVIDER OBSERVATIONS</p><h2 id="source-heading">Source health</h2></div><span className="panel-meta">source_health + source_controls · production</span></div>
        {snapshot.sourceRows.value === null ? <DataState state="unavailable" detail="Recorded source health could not be read." /> : snapshot.sourceRows.value.length === 0 ? <DataState state="empty" detail="No health rows are available; registered providers remain unobserved." /> : <div className="source-grid">{snapshot.sourceRows.value.map((source) => <article className="source-card" key={source.sourceKey}><div className="source-card-name"><span className={`source-indicator ${source.state}`} /><strong>{source.sourceKey}</strong></div><span className={`source-state ${source.state}`}>{displayState(source.state)}</span><small>Last checked · {formatDate(source.lastCheckedAt)}</small><small>Last success · {formatDate(source.lastSuccessAt)}</small><small>Last failure · {formatDate(source.lastFailureAt)}</small><small>Latency · {source.latencyMs === null ? "Not recorded" : `${source.latencyMs} ms`}{source.errorCode ? ` · ${source.errorCode}` : ""}</small>{source.failureCount !== null && source.failureCount > 0 && <small>{source.failureCount} consecutive source failure{source.failureCount === 1 ? "" : "s"}{source.nextRetryAt ? ` · retry ${formatDate(source.nextRetryAt)}` : ""}</small>}</article>)}</div>}
        <SourceStamp source="Supabase production · source_health + source_controls" range="Current recorded state · freshness threshold 24 hours" refreshedAt={snapshot.checkedAt} />
      </section>

      <section className="panel" aria-labelledby="evaluation-backlog-heading"><div className="panel-heading"><div><p className="eyebrow">BOUNDED EVALUATION</p><h2 id="evaluation-backlog-heading">Evaluation backlog</h2></div><span className="panel-meta">Private queue · current state</span></div>
        {snapshot.evaluationBacklog.value === null ? <DataState state="unavailable" detail="The private evaluation backlog could not be read. Queue depth and throughput are unavailable." /> : <>
          <div className="ops-stat-grid">
            <Stat label="Pending" value={snapshot.evaluationBacklog.value.pending} detail="Eligible roots awaiting evaluation" />
            <Stat label="Processing" value={snapshot.evaluationBacklog.value.processing} detail="Currently leased work" />
            <Stat label="Succeeded" value={snapshot.evaluationBacklog.value.succeeded} detail="Completed queue items" />
            <Stat label="Skipped" value={snapshot.evaluationBacklog.value.skipped} detail="Invalid or obsolete at revalidation" />
            <Stat label="Failed" value={snapshot.evaluationBacklog.value.failed} detail={`${snapshot.evaluationBacklog.value.exhausted} exhausted after bounded retries`} />
            <Stat label="Evaluated · 24h" value={snapshot.evaluationBacklog.value.evaluated24h} detail="Completed queue evaluations" />
            <Stat label="Qualified · 24h" value={snapshot.evaluationBacklog.value.qualified24h} detail="Canonical qualified evaluations" />
          </div>
          <p className="ops-monitor-dates">Oldest pending · {formatDate(snapshot.evaluationBacklog.value.oldestPendingAt)}<br />Evaluated / qualified · last hour · {formatNumber(snapshot.evaluationBacklog.value.evaluatedHour)} / {formatNumber(snapshot.evaluationBacklog.value.qualifiedHour)}<br />Average queue wait · {snapshot.evaluationBacklog.value.averageWaitSeconds === null ? "Not observed" : `${Math.round(snapshot.evaluationBacklog.value.averageWaitSeconds / 60)} min`} · Average attempts · {snapshot.evaluationBacklog.value.averageAttempts === null ? "Not observed" : snapshot.evaluationBacklog.value.averageAttempts.toFixed(1)}</p>
        </>}
        <SourceStamp source={snapshot.evaluationBacklog.source} range="Current queue state · completed throughput trailing 24 hours" refreshedAt={snapshot.checkedAt} />
      </section>

      <section className="panel" aria-labelledby="lifecycle-heading"><div className="panel-heading"><div><p className="eyebrow">LIFECYCLE AUTHORITY</p><h2 id="lifecycle-heading">Signal records</h2></div><span className="panel-meta">signals · all time</span></div>
        {snapshot.signalLifecycle.value === null ? <DataState state="unavailable" detail="Signal lifecycle records could not be read." /> : <div className="ops-stat-grid ops-stat-grid-six">
          <Stat label="Active" value={snapshot.signalLifecycle.value.active} detail="Current active records" />
          <Stat label="Saved" value={snapshot.signalLifecycle.value.saved} detail="Saved records" />
          <Stat label="Dismissed" value={snapshot.signalLifecycle.value.dismissed} detail="Dismissed records" />
          <Stat label="Archived" value={snapshot.signalLifecycle.value.archived} detail="Archived records" />
          <Stat label="Invalidated" value={snapshot.signalLifecycle.value.invalidated} detail="Invalidated records" />
          <Stat label="Retracted" value={snapshot.signalLifecycle.value.retracted} detail="Retracted records" />
        </div>}
        <SourceStamp source={snapshot.signalLifecycle.source} range="All lifecycle statuses · current persisted rows" refreshedAt={snapshot.checkedAt} />
      </section>
      <p className="data-footnote">Error payloads, provider queries, cursors, author content and raw customer content are omitted. This page is read-only; retries and replays are not exposed as controls.</p>
    </ConsoleShell>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="ops-stat"><span>{label}</span><strong>{typeof value === "number" ? formatNumber(value) : value}</strong><small>{detail}</small></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{typeof value === "number" ? formatNumber(value) : value}</dd></div>;
}

function formatNumber(value: number) { return new Intl.NumberFormat("en").format(value); }
function formatRate(value: number | null) { return value === null ? "Not observed" : `${(value * 100).toFixed(1)}%`; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Not observed"; }
function displayState(value: string) { return ({ blocked: "Critical", degraded: "Degraded", disabled: "Intentionally disabled", paused: "Paused", stale: "Stale", unknown: "Unknown", healthy: "Healthy" } as Record<string, string>)[value] ?? "Unknown"; }
