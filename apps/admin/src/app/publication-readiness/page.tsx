import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission, adminCan } from "@admin/server/auth";
import { ORGANIC_READINESS_FAMILIES, getOrganicReadinessSourceStatus } from "@admin/server/organic-intelligence-readiness";
import { recordOrganicCandidateReview } from "@admin/server/organic-review-actions";

export const dynamic = "force-dynamic";

function countLabel(value: number | undefined) {
  return value === undefined ? "0" : value.toLocaleString("en");
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatRatio(value: number | null) {
  return value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

export default async function OrganicPublicationReadinessPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const context = await requireAdminPermission("operations.summary.read");
  const readiness = await getOrganicReadinessSourceStatus();
  const params = await searchParams;
  const summary = readiness.summary;
  const canReview = adminCan(context, "organic_intelligence.review");
  const eligibility = summary?.candidateEligibilityStates ?? {};
  const reviewStates = summary?.candidateReviewStates ?? {};

  return (
    <ConsoleShell context={context} active="/publication-readiness">
      <PageHeading
        eyebrow="ORGANIC INTELLIGENCE / READINESS"
        title="Evidence before URLs."
        detail="A private read of globally scoped, reviewed public evidence through the existing SEO-2 eligibility engine. No public page is enabled here."
        aside={<span className="range-control">Publication disabled</span>}
      />

      {params.review === "saved" && <p className="organic-review-notice" role="status">The review decision was recorded with your current Admin identity.</p>}
      {params.review === "not-saved" && <p className="organic-review-notice error" role="alert">The review could not be recorded. Confirm your session and reviewer access, then try again.</p>}
      {params.review === "invalid" && <p className="organic-review-notice error" role="alert">The review form was incomplete or invalid. Enter a reason and submit again.</p>}
      {params.review === "unavailable" && <p className="organic-review-notice error" role="alert">The secure review service is unavailable. No review state was changed.</p>}

      <section className="panel seo-setup-panel" aria-labelledby="projection-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PUBLIC-SAFE CANDIDATE FEED</p>
            <h2 id="projection-heading">{readiness.state === "unavailable" ? "Read model unavailable" : `${countLabel(readiness.candidateCount ?? undefined)} candidate identities`}</h2>
          </div>
          <span className={`pill ${readiness.state === "available" ? "available" : "unavailable"}`}>
            {readiness.state === "available" ? "Read model connected" : readiness.state === "empty" ? "No approved evidence" : "Not connected"}
          </span>
        </div>
        {readiness.state !== "available" && <DataState state={readiness.state === "empty" ? "empty" : "unavailable"} detail={readiness.detail} />}
        {readiness.state === "available" && <p>{readiness.detail}</p>}
        <SourceStamp source={readiness.source} range={readiness.range} refreshedAt={readiness.refreshedAt} />
      </section>

      {summary && <>
        <section className="metric-grid seo-metric-grid organic-readiness-metrics" aria-label="Organic readiness measurements">
          <article className="metric-card"><span>Reviewed measurement policies</span><strong>{((summary.sourcePolicyStates.approved ?? 0) + (summary.sourcePolicyStates.restricted ?? 0)).toLocaleString("en")}</strong><p>Approved projection or aggregate-only use</p></article>
          <article className="metric-card"><span>Public evidence records</span><strong>{summary.publicEvidenceRecordCount.toLocaleString("en")}</strong><p>Verified episodes in currently reviewed public scope</p></article>
          <article className="metric-card"><span>Candidate identities</span><strong>{summary.candidateCount.toLocaleString("en")}</strong><p>Persisted candidates, not raw mentions</p></article>
          <article className="metric-card"><span>Eligible</span><strong>{countLabel(eligibility.eligible)}</strong><p>Current persisted SEO-2 decision</p></article>
          <article className="metric-card"><span>Review required</span><strong>{countLabel(reviewStates.review_required)}</strong><p>Needs an attributable human decision</p></article>
          <article className="metric-card"><span>Stale</span><strong>{summary.staleCount.toLocaleString("en")}</strong><p>Based on latest candidate evaluations</p></article>
          <article className="metric-card"><span>Average source concentration</span><strong>{formatRatio(summary.averageSourceConcentration)}</strong><p>Across latest persisted candidate evaluations</p></article>
          <article className="metric-card"><span>Highest viral-event concentration</span><strong>{formatRatio(summary.maximumViralEventConcentration)}</strong><p>Collapsed event concentration, not raw volume</p></article>
        </section>

        <section className="panel seo-data-panel" aria-labelledby="page-families-heading">
          <div className="panel-heading"><div><p className="eyebrow">SEO-2 PAGE FAMILIES</p><h2 id="page-families-heading">Persisted candidates by family</h2></div><span className="panel-meta">Counts are actual candidate rows</span></div>
          <ul className="readiness-family-list">{ORGANIC_READINESS_FAMILIES.map((family) => (
            <li key={family.key}><span>{family.label}</span><span className="status-chip">{countLabel(summary.candidateFamilies[family.key])} candidates</span></li>
          ))}</ul>
        </section>

        <section className="panel seo-data-panel" aria-labelledby="distribution-heading">
          <div className="panel-heading"><div><p className="eyebrow">MEASURED DISTRIBUTION</p><h2 id="distribution-heading">What the feed currently contains</h2></div><span className="panel-meta">Latest persisted evaluation state · no thresholds changed</span></div>
          <div className="organic-distribution-grid">
            <div><h3>Candidate maturity</h3>{Object.keys(summary.maturityStates).length ? <ul>{Object.entries(summary.maturityStates).map(([key, count]) => <li key={key}><span>{humanize(key)}</span><strong>{count.toLocaleString("en")}</strong></li>)}</ul> : <p className="dim-value">No maturity evaluations recorded.</p>}</div>
            <div><h3>Blocker distribution</h3>{Object.keys(summary.blockerDistribution).length ? <ul>{Object.entries(summary.blockerDistribution).map(([key, count]) => <li key={key}><span>{humanize(key)}</span><strong>{count.toLocaleString("en")}</strong></li>)}</ul> : <p className="dim-value">No blocker evaluations recorded.</p>}</div>
            <div><h3>Evidence by source family</h3>{Object.keys(summary.episodeFamilies).length ? <ul>{Object.entries(summary.episodeFamilies).map(([key, count]) => <li key={key}><span>{humanize(key)}</span><strong>{count.toLocaleString("en")}</strong></li>)}</ul> : <p className="dim-value">No approved evidence episodes recorded.</p>}<p className="organic-footnote">Providers in one family do not count as independent source families.</p></div>
            <div><h3>Registered provider-family mappings</h3>{Object.keys(summary.sourceFamilies).length ? <ul>{Object.entries(summary.sourceFamilies).map(([key, count]) => <li key={key}><span>{humanize(key)}</span><strong>{count.toLocaleString("en")}</strong></li>)}</ul> : <p className="dim-value">No mappings available.</p>}<p className="organic-footnote">Mapping counts do not indicate rights approval or evidence volume.</p></div>
          </div>
          <SourceStamp source="organic_readiness_evaluations · latest row per candidate" range="Current persisted snapshot" refreshedAt={summary.lastEvaluatedAt} />
        </section>

        <section className="panel organic-candidates-panel" aria-labelledby="candidates-heading">
          <div className="panel-heading"><div><p className="eyebrow">PRIVATE HUMAN REVIEW</p><h2 id="candidates-heading">Candidate register</h2></div><span className="panel-meta">{summary.reviewEventCount.toLocaleString("en")} attributable review events</span></div>
          {summary.candidates.length === 0
            ? <DataState state="empty" detail="No persisted candidate evaluations are available. No examples or estimated metrics are substituted." />
            : <ul className="organic-candidate-list">{summary.candidates.map((candidate) => (
              <li className="organic-candidate" key={candidate.id}>
                <div className="organic-candidate-heading"><div><p className="eyebrow">{humanize(candidate.family)}</p><h3>{candidate.label}</h3></div><span className={`status-chip status-${candidate.reviewState}`}>{humanize(candidate.reviewState)}</span></div>
                <p className="organic-candidate-state"><span>Eligibility</span><strong>{humanize(candidate.eligibilityState)}</strong><span>Maturity</span><strong>{candidate.maturityState ? humanize(candidate.maturityState) : "Unavailable"}</strong><span>Truth</span><strong>{candidate.truthState ? humanize(candidate.truthState) : "Unavailable"}</strong><span>Safety</span><strong>{candidate.safetyState ? humanize(candidate.safetyState) : "Unavailable"}</strong></p>
                <dl className="organic-candidate-measures">
                  <div><dt>Independent episodes</dt><dd>{candidate.independentEpisodeCount?.toLocaleString("en") ?? "Unavailable"}</dd></div>
                  <div><dt>Reliable unique authors</dt><dd>{candidate.uniqueAuthorCount?.toLocaleString("en") ?? "Unavailable"}</dd></div>
                  <div><dt>Source-family breadth</dt><dd>{candidate.sourceFamilyCount?.toLocaleString("en") ?? "Unavailable"}</dd></div>
                  <div><dt>Time buckets</dt><dd>{candidate.timeBucketCount?.toLocaleString("en") ?? "Unavailable"}</dd></div>
                  <div><dt>Observed window</dt><dd>{candidate.firstObservedAt && candidate.lastObservedAt ? `${candidate.firstObservedAt.slice(0, 10)} – ${candidate.lastObservedAt.slice(0, 10)} UTC` : "Unavailable"}</dd></div>
                  <div><dt>Duplicate ratio</dt><dd>{formatRatio(candidate.duplicateRatio)}</dd></div>
                  <div><dt>Source concentration</dt><dd>{formatRatio(candidate.sourceConcentration)}</dd></div>
                  <div><dt>Viral concentration</dt><dd>{formatRatio(candidate.viralEventConcentration)}</dd></div>
                  <div><dt>Freshness</dt><dd>{candidate.freshnessState ? humanize(candidate.freshnessState) : "Unavailable"}</dd></div>
                  <div><dt>Search Console priority</dt><dd>{candidate.searchConsolePriority ? humanize(candidate.searchConsolePriority) : "Unavailable"}</dd></div>
                </dl>
                <details className="organic-provenance"><summary>Internal provenance references ({candidate.provenanceEpisodeRefs.length})</summary><p>Public intelligence ID: <code>{candidate.publicIntelligenceId}</code>. Episode identifiers only; source bodies, author identifiers, and provider payloads are never returned by this view.</p><code>{candidate.provenanceEpisodeRefs.length ? candidate.provenanceEpisodeRefs.join(" · ") : "No reviewed episode references recorded."}</code></details>
                {candidate.blockerCodes?.length ? <p className="organic-blockers"><strong>Blockers</strong> {candidate.blockerCodes.map(humanize).join(" · ")}</p> : null}
                <p className="organic-candidate-time">Evaluated: {candidate.evaluatedAt ? new Date(candidate.evaluatedAt).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : "Unavailable"}</p>
                {canReview && (candidate.reviewState === "eligible" || (candidate.reviewState === "candidate" && candidate.eligibilityState === "eligible_review_required")) && <form action={recordOrganicCandidateReview} className="organic-review-form"><input type="hidden" name="candidateId" value={candidate.id} /><label>Review reason<input name="reason" required maxLength={500} /></label><button name="action" value="request_review" type="submit">Request human review</button></form>}
                {canReview && candidate.reviewState === "review_required" && <form action={recordOrganicCandidateReview} className="organic-review-form"><input type="hidden" name="candidateId" value={candidate.id} /><label>Decision reason<input name="reason" required maxLength={500} /></label><button name="action" value="approve" type="submit">Approve candidate</button><button className="secondary" name="action" value="reject" type="submit">Reject candidate</button></form>}
              </li>
            ))}</ul>}
          <SourceStamp source="organic_readiness_candidates + latest evaluation + normalized episode provenance" range="Current candidate snapshot" refreshedAt={summary.lastEvaluatedAt} />
        </section>
      </>}

      <section className="panel seo-data-panel" aria-labelledby="policy-heading">
        <div className="panel-heading"><div><p className="eyebrow">REVIEW POLICY</p><h2 id="policy-heading">Eligibility precedes search demand</h2></div></div>
        <ul className="readiness-policy-list">
          <li>Independent episodes, reliable authors, source-family breadth, time coverage, freshness, and concentration come from approved public evidence only.</li>
          <li>Private connectors, workspace-selected evidence, customer interpretation, Actions, experiments, and raw provider payloads are excluded.</li>
          <li>Search Console can reprioritize an eligible candidate; it cannot change eligibility.</li>
          <li>Human approval is attributable and audited. There is no publish action or public route.</li>
        </ul>
      </section>
    </ConsoleShell>
  );
}
