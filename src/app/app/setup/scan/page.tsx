import Link from "next/link";
import { redirect } from "next/navigation";

import { FirstScanForm } from "@/components/onboarding/setup-forms";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";
import { getInitialScanState } from "@/server/modules/onboarding";

export default async function ScanSetupPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) redirect("/app/setup/workspace");
  if (!product) redirect("/app/setup/product");
  if (!product.current_snapshot_id || !product.current_demand_profile_id) redirect("/app/setup/product");

  const scan = await getInitialScanState(workspace.id, product.id);
  const signals = await listSignalsQuery(workspace.id, product.id, { limit: 1 });
  if (signals.length) redirect("/app/signals");
  const completedNoSignals = scan?.result?.state === "complete_no_signals";
  const failed = scan?.status === "failed";
  const running = scan?.status === "running";
  const phaseLabel = scan?.phase === "preparing" ? "Preparing the scan…" : scan?.phase === "discovering" ? "Discovering conversations…" : scan?.phase === "analyzing" ? "Analyzing conversations…" : scan?.phase === "matching" ? "Matching conversations to your product…" : scan?.phase === "ranking" ? "Ranking the results…" : "The first scan is in progress…";
  return (
    <section className="dashboard-page onboarding-page">
      <p className="dashboard-eyebrow">First scan</p>
      <h1>{completedNoSignals ? "Your first scan is complete." : failed ? "The first scan needs another try." : running ? phaseLabel : "Find your first Signals."}</h1>
      <p className="dashboard-subtitle">{completedNoSignals ? "The enabled sources returned no qualified Signals this time. You can review the empty feed while the persisted scan remains available for inspection." : failed ? (scan.errorMessage ?? "No usable source results were available.") : running ? "This state is persisted in the backend, so refreshing will safely resume from the recorded scan status." : "Use the existing provider-neutral pipeline to discover and score a small, inspectable set of conversations."}</p>
      <div className="dashboard-panel onboarding-panel">
        {scan?.result ? <div className="onboarding-result" aria-live="polite"><strong>{scan.result.signals} Signals</strong><span>{scan.result.rawItems} raw items · {scan.result.conversations} conversations · {scan.result.sources.join(", ") || "no enabled sources"}</span></div> : null}
        {running ? <p className="onboarding-status" role="status">{phaseLabel}</p> : completedNoSignals ? <div className="onboarding-actions"><Link className="dashboard-button dashboard-button-secondary" href="/app/signals">Open Signals</Link></div> : <FirstScanForm workspaceId={workspace.id} productId={product.id} />}
      </div>
    </section>
  );
}
