import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import type { DashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getBillingOverviewQuery } from "@/server/modules/billing";
import { getWorkspaceCohortIdentityQuery, workspaceCohortPresentation } from "@/server/modules/cohorts";
import { WorkspaceCohortIdentity } from "./workspace-cohort-identity";
import { ContextSwitchers } from "./context-switchers";
import { DashboardNav } from "./dashboard-nav";
import { UserAccount } from "./user-account";
import { TopBar } from "./top-bar";
import { LogoMark } from "./nav-icons";
import { getInboxItems } from "./inbox";
import { domainFromUrl } from "./dashboard-utils";

type TopBarProps = {
  workspaceId: string;
  productId: string;
  productName: string;
  productDomain: string | null;
  userInitial: string;
  currentPlan: "free" | "pro" | "growth";
  cohortIdentity: { cohort: "founding_25" | "early_100"; number: number } | null;
};

async function DeferredTopBar({ props, inboxItemsPromise }: { props: TopBarProps; inboxItemsPromise: Promise<Awaited<ReturnType<typeof getInboxItems>>> }) {
  const inboxItems = await inboxItemsPromise;
  return <TopBar {...props} inboxItems={inboxItems} />;
}

export async function DashboardShell({ context, children }: { context: DashboardContext; children: ReactNode }) {
  const { workspace, product } = context;
  // Parallel, request-memoized private reads for the selected workspace only. The
  // compact cohort badge comes from the authenticated workspace identity RPC,
  // never from the public wall or a public slug.
  const [billing, cohortRead] = workspace ? await Promise.all([
    getBillingOverviewQuery(workspace.id).catch(() => null),
    getWorkspaceCohortIdentityQuery(workspace.id).catch(() => null),
  ]) : [null, null];
  const cohortIdentity = compactCohort(cohortRead);
  const topBarProps = workspace && product ? {
    workspaceId: workspace.id,
    productId: product.id,
    productName: product.name,
    productDomain: domainFromUrl(product.website_url),
    userInitial: (context.userEmail?.[0] ?? "U").toUpperCase(),
    currentPlan: billing?.effectivePlan ?? "free",
    cohortIdentity,
  } : null;
  const inboxItemsPromise = topBarProps
    ? getInboxItems(topBarProps.workspaceId, topBarProps.productId).catch(() => [])
    : null;

  return (
    <div className="dashboard-app">
      <aside className="dashboard-sidebar">
        <Link className="dashboard-logo" href="/app" aria-label="Wanterest overview">
          <span className="dashboard-logo-mark" aria-hidden="true"><LogoMark /></span>
          <span>wanterest</span>
        </Link>
        <ContextSwitchers workspaces={context.workspaces} workspace={context.workspace} products={context.products} product={context.product} />
        <DashboardNav />
        <div className="dashboard-sidebar-footer">
          {cohortIdentity ? <WorkspaceCohortIdentity {...cohortIdentity} /> : null}
          <UserAccount email={context.userEmail} />
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand"><LogoMark /> wanterest{cohortIdentity ? <WorkspaceCohortIdentity {...cohortIdentity} placement="mobile" /> : null}</div>
        {topBarProps && inboxItemsPromise ? (
          <Suspense fallback={<TopBar {...topBarProps} inboxItems={[]} />}>
            <DeferredTopBar props={topBarProps} inboxItemsPromise={inboxItemsPromise} />
          </Suspense>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function compactCohort(identity: Awaited<ReturnType<typeof getWorkspaceCohortIdentityQuery>> | null) {
  if (!identity) return null;
  try {
    const presentation = workspaceCohortPresentation(identity);
    return presentation ? { cohort: presentation.cohort, number: presentation.number } : null;
  } catch {
    return null;
  }
}
