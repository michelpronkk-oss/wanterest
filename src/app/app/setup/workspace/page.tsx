import { redirect } from "next/navigation";

import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { WorkspaceSetupForm } from "@/components/onboarding/setup-forms";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function WorkspaceSetupPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const websiteUrl = tryNormalizePublicWebsiteUrl(typeof query.website === "string" ? query.website : null);
  const { workspace } = await getDashboardContext();
  if (workspace) redirect(websiteUrl ? `/app/setup/product?website=${encodeURIComponent(websiteUrl)}` : "/app/setup/product");
  return (
    <OnboardingShell step={1}>
      <div className="onboarding-step">
        <p className="onboarding-step-eyebrow">Step 1 of 3</p>
        <h1 className="onboarding-headline">What should we call your workspace?</h1>
        <p className="onboarding-subcopy">A private workspace for your team&rsquo;s demand intelligence &mdash; products, Signals, and results all live here.</p>
        <WorkspaceSetupForm initialWebsiteUrl={websiteUrl} />
      </div>
    </OnboardingShell>
  );
}
