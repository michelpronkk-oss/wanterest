import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getDemandDriftQuery, getDemandGapQuery, getDemandMapQuery, getDemandMapV2Query, isDemandMapV2Enabled } from "@/server/modules/demand-intelligence/commands";
import { formatPercent, themeLabel } from "@/components/dashboard/dashboard-utils";
import { marketStateCopy } from "@/components/dashboard/demand-map-concepts";
import { InsightsDataEmptyState, InsightsScopeEmptyState } from "@/components/dashboard/insights-empty-states";

export default async function InsightsOverviewPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace || !product) {
    return <InsightsScopeEmptyState workspace={workspace} product={product} />;
  }

  const v2Enabled = isDemandMapV2Enabled();
  const [v2Map, legacyMap, gapResult, driftResult] = await Promise.all([
    v2Enabled ? getDemandMapV2Query(workspace.id, product.id).catch(() => null) : Promise.resolve(null),
    v2Enabled ? Promise.resolve(null) : getDemandMapQuery(workspace.id, product.id).catch(() => null),
    getDemandGapQuery(workspace.id, product.id).catch(() => null),
    getDemandDriftQuery(workspace.id, product.id).catch(() => null),
  ]);
  const mapResult = v2Enabled ? v2Map?.historical.legacy ?? null : legacyMap;
  const hasClusterContent = Boolean(v2Map && (v2Map.current.length || v2Map.previouslyObserved.length));

  if ((!mapResult || (mapResult.snapshot.qualified_signal_count === 0 && mapResult.themes.length === 0)) && !hasClusterContent) {
    return (
      <InsightsDataEmptyState
        workspaceId={workspace.id}
        productId={product.id}
        fallbackTitle="No demand intelligence yet"
        fallbackBody="Insights build up after your first completed scan produces enough qualified conversations."
      />
    );
  }

  const themes = mapResult?.themes ?? [];
  const phrases = mapResult?.phrases ?? [];
  const snapshot = mapResult?.snapshot ?? null;
  const topThemes = [...themes].sort((a, b) => b.share_of_demand - a.share_of_demand).slice(0, 4);
  const intentMix = snapshot ? Object.entries(snapshot.intent_mix as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
  const sourceCount = snapshot ? Object.keys(snapshot.source_mix as Record<string, number>).length : 0;
  const topTheme = topThemes[0] ?? null;
  const topGap = gapResult ? [...gapResult.gaps].sort((a, b) => b.gap_score - a.gap_score)[0] ?? null : null;
  const topDrift = driftResult ? [...driftResult.drifts].sort((a, b) => Math.abs(b.share_delta) - Math.abs(a.share_delta))[0] ?? null : null;
  const topOutcome = phrases.filter((phrase) => phrase.phrase_type === "desired_outcome").sort((a, b) => b.share_of_demand - a.share_of_demand)[0] ?? null;
  const historical = v2Enabled ? " (historical, not lifecycle-filtered)" : "";

  return (
    <div style={{ marginTop: 20 }}>
      <div className="insights-market-state">
        <div className="insights-market-state-label">Market state</div>
        {v2Enabled ? (
          <>
            <div className="insights-market-state-body">{v2Map ? marketStateCopy(v2Map) : "Current demand is temporarily unavailable."}</div>
            {v2Map ? (
              <div className="insights-market-state-meta">
                <div>{v2Map.totals.activeEvidenceCount} current distinct conversation{v2Map.totals.activeEvidenceCount === 1 ? "" : "s"}</div>
                <div>·</div>
                <div>{v2Map.totals.activeSourceCount} current source{v2Map.totals.activeSourceCount === 1 ? "" : "s"}</div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="insights-market-state-body">
              {topTheme
                ? `${themeLabel(topTheme.theme_key)} leads demand at ${formatPercent(topTheme.share_of_demand)} of qualified conversations.`
                : "Not enough qualified conversations yet to characterize the market."}
            </div>
            {snapshot ? (
              <div className="insights-market-state-meta">
                <div>{snapshot.sample_size} conversations analyzed</div>
                <div>·</div>
                <div>{sourceCount} source{sourceCount === 1 ? "" : "s"}</div>
                <div>·</div>
                <div>{snapshot.measurement_quality.replaceAll("_", " ")}</div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {mapResult ? (
        <>
          <div className="insights-two-col">
            <div className="ui-card ui-card-pad-lg">
              <div className="ui-section-label">Top demand themes{historical}</div>
              {topThemes.map((theme) => (
                <div className="insights-row" key={theme.id}>
                  <div style={{ fontSize: 13.5 }}>{themeLabel(theme.theme_key)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{theme.mention_count} mentions</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{formatPercent(theme.share_of_demand)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ui-card ui-card-pad-lg">
              <div className="ui-section-label">Intent mix{historical}</div>
              {intentMix.map(([label, pct]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <span className="badge-dot" style={{ color: "var(--color-accent)" }} />
                  <div style={{ fontSize: 13, flex: 1 }}>{themeLabel(label)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{formatPercent(pct)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="insights-highlight-grid">
            <div className="insights-highlight-card">
              <div className="metric-card-label">Biggest change{historical}</div>
              {topDrift ? (
                <>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{themeLabel(topDrift.concept_key)} demand {topDrift.drift_direction} {formatPercent(Math.abs(topDrift.share_delta))}</div>
                  <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{topDrift.significance} significance</div>
                </>
              ) : <div style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Needs a second scan to compare.</div>}
            </div>
            <div className="insights-highlight-card">
              <div className="metric-card-label">Largest positioning gap{historical}</div>
              {topGap ? (
                <>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{themeLabel(topGap.concept_key)} (+{Math.round(topGap.gap_score * 100)} gap)</div>
                  <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{topGap.market_mentions} signals</div>
                </>
              ) : <div style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No gap analysis yet.</div>}
            </div>
            <div className="insights-highlight-card">
              <div className="metric-card-label">Strongest desired outcome{historical}</div>
              {topOutcome ? (
                <>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>&ldquo;{topOutcome.phrase}&rdquo;</div>
                  <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{topOutcome.mention_count} signals</div>
                </>
              ) : <div style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No recurring outcomes yet.</div>}
            </div>
          </div>
        </>
      ) : null}
      <p style={{ marginTop: 16 }}><Link href="/app/insights/map" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}>View full demand map →</Link></p>
    </div>
  );
}
