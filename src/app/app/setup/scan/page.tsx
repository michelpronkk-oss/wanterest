import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { OnboardingScanStatus } from "@/components/onboarding/onboarding-scan-status";
import { deriveProductUnderstanding } from "@/components/onboarding/product-understanding";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getCurrentProductSnapshotQuery } from "@/server/modules/intelligence/commands";
import { getInitialScanState } from "@/server/modules/onboarding";
import { getOnboardingStatusAction } from "@/app/app/setup/actions";

export default async function ScanSetupPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) redirect("/app/setup/workspace");
  if (!product) redirect("/app/setup/product");
  if (!product.current_snapshot_id || !product.current_demand_profile_id) redirect("/app/setup/product");

  const [snapshot, scan, status] = await Promise.all([
    getCurrentProductSnapshotQuery(workspace.id, product.id).catch(() => null),
    getInitialScanState(workspace.id, product.id).catch(() => null),
    getOnboardingStatusAction({ workspaceId: workspace.id, productId: product.id }),
  ]);

  const understanding = deriveProductUnderstanding(snapshot);

  return (
    <OnboardingShell step={3}>
      <div className="onboarding-step is-wide">
        <p className="onboarding-step-eyebrow">Step 3 of 3</p>
        <h1 className="onboarding-headline is-compact">Here&rsquo;s what we think you sell</h1>
        <p className="onboarding-subcopy">Confirm this looks right &mdash; you can refine it anytime in Settings.</p>

        <div className="onboarding-card">
          <div className="onboarding-card-label">What you do</div>
          {understanding.whatYouDo ? (
            <div className="onboarding-card-body">{understanding.whatYouDo}</div>
          ) : (
            <div className="onboarding-card-body" style={{ color: "var(--color-ink-muted)" }}>Still preparing your product understanding&hellip;</div>
          )}

          {understanding.whoItsFor.length > 0 ? (
            <>
              <div className="onboarding-card-label">Who it&rsquo;s for</div>
              <div className="onboarding-chip-row">
                {understanding.whoItsFor.map((audience) => <span className="onboarding-chip" key={audience}>{audience}</span>)}
              </div>
            </>
          ) : null}

          {understanding.watchingFor.length > 0 ? (
            <>
              <div className="onboarding-card-label">Watching for</div>
              <div className="onboarding-chip-row">
                {understanding.watchingFor.map((term) => <span className="onboarding-chip" key={term}>{term}</span>)}
              </div>
            </>
          ) : null}
        </div>

        <Link className="onboarding-cta" href="/app">Open my dashboard now →</Link>

        <OnboardingScanStatus workspaceId={workspace.id} productId={product.id} hasScan={scan !== null} initialStatus={status} />
      </div>
    </OnboardingShell>
  );
}
