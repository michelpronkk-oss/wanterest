import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/modules/auth";
import { getDashboardContext, resolveOnboardingStep } from "@/server/modules/dashboard/dashboard.context";
import { getProductScanState } from "@/components/dashboard/scan-state";
import { getEntryDestination } from "@/shared/config/entry-flow";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function InvalidWebsiteEntry() {
  return (
    <main className="auth-fallback-page">
      <section className="auth-fallback-card" aria-labelledby="invalid-website-title">
        <div className="auth-fallback-wordmark" aria-label="Wanterest">
          <span className="auth-fallback-wordmark-mark" aria-hidden="true">W</span>
          <span>Wanterest</span>
        </div>
        <div className="auth-fallback-heading">
          <p className="auth-fallback-eyebrow">One quick check</p>
          <h1 id="invalid-website-title">That website needs a closer look.</h1>
          <p>Enter a public website or domain, such as linear.app.</p>
        </div>
        <Link className="auth-fallback-submit" href="/start">Try again</Link>
      </section>
    </main>
  );
}

export default async function StartPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const rawWebsite = typeof query.website === "string" ? query.website : null;
  const websiteUrl = rawWebsite === null ? null : tryNormalizePublicWebsiteUrl(rawWebsite);
  if (rawWebsite !== null && !websiteUrl) return <InvalidWebsiteEntry />;

  const user = await getCurrentUser();
  if (!user) redirect(getEntryDestination({ authenticated: false, hasWorkspace: false, hasProduct: false, productUnderstandingReady: false, scanState: null }, websiteUrl));

  const context = await getDashboardContext();
  const onboardingStep = resolveOnboardingStep(context);
  const scanState = context.workspace && context.product && !onboardingStep
    ? (await getProductScanState(context.workspace.id, context.product.id, false)).kind
    : null;
  redirect(getEntryDestination({
    authenticated: true,
    hasWorkspace: Boolean(context.workspace),
    hasProduct: Boolean(context.product),
    productUnderstandingReady: Boolean(context.product?.current_snapshot_id && context.product?.current_demand_profile_id),
    scanState,
  }, context.product ? null : websiteUrl));
}
