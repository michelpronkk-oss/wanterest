import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getDemandDriftQuery, getDemandMapQuery, getDemandMapV2Query, isDemandMapV2Enabled } from "@/server/modules/demand-intelligence/commands";
import { loadDemandMapView, type DemandMapV2ReadModel } from "@/server/modules/demand-intelligence/demand-map.policy";
import type { DemandMapReadModel } from "@/server/modules/demand-intelligence/demand.schemas";
import { formatDate, themeLabel } from "@/components/dashboard/dashboard-utils";
import { DemandMapCurrentConcepts, DemandMapPreviouslyObserved, HistoricalEvidenceSection, demandMapHeadline, historicalCaption } from "@/components/dashboard/demand-map-concepts";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";
import { ThemeTable } from "@/components/dashboard/theme-table";

export default async function DemandMapPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) return <InsightsScopeEmptyState workspace={workspace} product={product} />;

  const view = await loadDemandMapView({
    enabled: isDemandMapV2Enabled(),
    loadLegacy: () => getDemandMapQuery(workspace.id, product.id).catch(() => null),
    loadV2: () => getDemandMapV2Query(workspace.id, product.id).catch(() => null),
  });

  if (view.mode === "v2") {
    const map = view.map;
    if (!map || (map.current.length === 0 && map.previouslyObserved.length === 0 && !map.historical.legacy)) {
      return (
        <InsightsDataEmptyState
          workspaceId={workspace.id}
          productId={product.id}
          fallbackTitle={map ? "No current demand confirmed" : "Demand map is temporarily unavailable"}
          fallbackBody={map ? "No qualified evidence has been grouped into demand concepts for this product yet." : "The demand map could not be loaded. Your saved intelligence is unchanged; try again shortly."}
        />
      );
    }
    return <DemandMapV2 map={map} />;
  }

  const mapResult = view.legacy;
  if (!mapResult || (mapResult.snapshot.qualified_signal_count === 0 && mapResult.themes.length === 0)) {
    return (
      <InsightsDataEmptyState
        workspaceId={workspace.id}
        productId={product.id}
        fallbackTitle="No demand map yet"
        fallbackBody="The demand map builds up after your first completed scan produces enough qualified conversations."
      />
    );
  }
  const driftResult = await getDemandDriftQuery(workspace.id, product.id).catch(() => null);

  const { themes, snapshot } = mapResult;
  const sortedThemes = [...themes].sort((a, b) => b.share_of_demand - a.share_of_demand);
  const sourceCount = Object.keys(snapshot.source_mix as Record<string, number>).length;

  return (
    <div style={{ marginTop: 20 }}>
      <div className="insights-stat-grid">
        <div className="insights-stat-card"><div className="insights-stat-card-label">Themes tracked</div><div className="insights-stat-card-value">{themes.length}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Qualified signals</div><div className="insights-stat-card-value">{snapshot.qualified_signal_count}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Fastest growing</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>{driftResult ? themeLabel([...driftResult.drifts].sort((a, b) => b.share_delta - a.share_delta)[0]?.concept_key ?? "—") : "—"}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Source coverage</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>{sourceCount} source{sourceCount === 1 ? "" : "s"}</div></div>
      </div>

      <div className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
        <div className="ui-section-label" style={{ marginBottom: 2 }}>Demand themes</div>
        <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 14 }}>Structured evidence behind each recurring theme. Select a theme for details.</p>
        <ThemeTable themes={sortedThemes} drifts={driftResult?.drifts ?? []} />
      </div>

      <LegacyLanguageAndAlternatives mapResult={mapResult} />
    </div>
  );
}

function LegacyLanguageAndAlternatives({ mapResult }: { mapResult: DemandMapReadModel }) {
  const buyerLanguage = mapResult.phrases.filter((phrase) => phrase.phrase_type === "buyer_language").sort((a, b) => b.share_of_demand - a.share_of_demand).slice(0, 6);
  const sortedAlternatives = [...mapResult.alternatives].sort((a, b) => b.mention_count - a.mention_count).slice(0, 8);
  return (
    <div className="insights-two-col">
      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">How buyers describe the problem</div>
        {buyerLanguage.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No recurring buyer language yet.</p> : buyerLanguage.map((phrase) => (
          <div key={phrase.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
            <div style={{ flex: 1, fontSize: 13, color: "var(--color-ink-secondary)" }}>&ldquo;{phrase.phrase}&rdquo;</div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)", flexShrink: 0 }}>{phrase.mention_count}</div>
          </div>
        ))}
      </div>
      <div className="ui-card ui-card-pad-lg">
        <div className="ui-section-label">Alternatives mentioned</div>
        {sortedAlternatives.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No alternatives mentioned yet.</p> : sortedAlternatives.map((alternative, index) => (
          <div key={alternative.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--color-chip)", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{index + 1}</span>
            <div style={{ fontSize: 13.5, flex: 1 }}>{alternative.alternative}</div>
            <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{alternative.mention_count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemandMapV2({ map }: { map: DemandMapV2ReadModel }) {
  const headline = demandMapHeadline(map);
  const legacy = map.historical.legacy;
  return (
    <div style={{ marginTop: 20 }}>
      <div className="insights-stat-grid">
        <div className="insights-stat-card"><div className="insights-stat-card-label">Current demand concepts</div><div className="insights-stat-card-value">{map.totals.currentConceptCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Current distinct evidence</div><div className="insights-stat-card-value">{map.totals.activeEvidenceCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Current sources</div><div className="insights-stat-card-value">{map.totals.activeSourceCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Last current evidence</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>{map.totals.lastActiveEvidenceAt ? formatDate(map.totals.lastActiveEvidenceAt) : "—"}</div></div>
      </div>

      <div className="ui-card ui-card-pad-lg" style={{ marginBottom: 16 }}>
        <div className="ui-section-label" style={{ marginBottom: 2 }}>{headline.title}</div>
        <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", marginBottom: map.current.length ? 10 : 0 }}>{headline.body}</p>
        {map.current.length ? <DemandMapCurrentConcepts concepts={map.current} /> : null}
      </div>

      <DemandMapPreviouslyObserved concepts={map.previouslyObserved} />

      {legacy ? (
        <HistoricalEvidenceSection caption={historicalCaption(legacy)}>
          <div style={{ marginBottom: 16 }}>
            <ThemeTable themes={[...legacy.themes].sort((a, b) => b.share_of_demand - a.share_of_demand)} drifts={[]} />
          </div>
          <LegacyLanguageAndAlternatives mapResult={legacy} />
        </HistoricalEvidenceSection>
      ) : null}
    </div>
  );
}
