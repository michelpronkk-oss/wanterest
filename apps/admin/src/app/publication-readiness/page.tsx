import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { getOrganicReadinessSourceStatus } from "@admin/server/organic-intelligence-readiness";

export const dynamic = "force-dynamic";

export default async function OrganicPublicationReadinessPage() {
  const context = await requireAdminPermission("operations.summary.read");
  const readiness = getOrganicReadinessSourceStatus();

  return (
    <ConsoleShell context={context} active="/publication-readiness">
      <PageHeading
        eyebrow="ORGANIC INTELLIGENCE / READINESS"
        title="Evidence before URLs."
        detail="A private, read-only view of what can eventually support public intelligence. Eligibility depends on Wanterest evidence, not a keyword target."
        aside={<span className="range-control">Publication disabled</span>}
      />

      <section className="panel seo-setup-panel" aria-labelledby="projection-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CANDIDATE PROJECTION</p>
            <h2 id="projection-heading">No reviewed candidate feed</h2>
          </div>
          <span className="pill unavailable">Not connected</span>
        </div>
        <DataState state="unavailable" detail={readiness.detail} />
        <p>No candidate names, example metrics, source excerpts, or workspace intelligence are shown in this state.</p>
        <SourceStamp source={readiness.source} range="No candidate objects evaluated" refreshedAt={readiness.evaluatedAt} />
      </section>

      <section className="panel seo-data-panel" aria-labelledby="families-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">FUTURE PAGE FAMILIES</p><h2 id="families-heading">Families 3–8</h2></div>
          <span className="panel-meta">Readiness contracts only</span>
        </div>
        <ul className="readiness-family-list">
          {readiness.families.map((family) => (
            <li key={family.key}>
              <span>{family.label}</span>
              <span className="status-chip">Not evaluated</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel seo-data-panel" aria-labelledby="policy-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">REVIEW POLICY</p><h2 id="policy-heading">Eligibility precedes search demand</h2></div>
        </div>
        <ul className="readiness-policy-list">
          <li>Independent episodes, authors, source-family breadth, time coverage, freshness, and concentration must be measured independently.</li>
          <li>Workspace-scoped Demand Map, Gap, Drift, Actions, and experiment state stay private.</li>
          <li>Search Console may prioritize an already-eligible candidate for review; it cannot create or qualify one.</li>
          <li>Every first-cohort approval and publication remains a human, attributable decision.</li>
        </ul>
      </section>
    </ConsoleShell>
  );
}
