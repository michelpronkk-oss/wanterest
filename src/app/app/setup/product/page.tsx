import { redirect } from "next/navigation";

import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { ProductSetupForm, ProductUnderstandingForm } from "@/components/onboarding/setup-forms";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getCurrentProductSnapshotQuery } from "@/server/modules/intelligence/commands";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductSetupPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) redirect("/app/setup/workspace");

  const query = await searchParams;
  const forceNew = query.new !== undefined;
  const activeProduct = forceNew ? null : product;
  if (activeProduct && activeProduct.current_snapshot_id && activeProduct.current_demand_profile_id) redirect("/app/setup/scan");
  const existingSnapshot = activeProduct
    ? await getCurrentProductSnapshotQuery(workspace.id, activeProduct.id).catch(() => null)
    : null;

  return (
    <OnboardingShell step={2}>
      <div className="onboarding-step">
        <p className="onboarding-step-eyebrow">Step 2 of 3</p>
        <h1 className="onboarding-headline">What does your business sell?</h1>
        <p className="onboarding-subcopy">Tell us your site and what you do &mdash; we&rsquo;ll surface where people are already looking for exactly that.</p>
        {activeProduct ? (
          <ProductUnderstandingForm workspaceId={workspace.id} productId={activeProduct.id} websiteUrl={activeProduct.website_url} initialDescription={existingSnapshot?.normalized_text ?? existingSnapshot?.raw_text ?? null} />
        ) : (
          <ProductSetupForm workspaceId={workspace.id} />
        )}
      </div>
    </OnboardingShell>
  );
}
