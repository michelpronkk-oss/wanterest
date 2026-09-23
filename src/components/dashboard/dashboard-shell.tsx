import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import type { DashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { getBillingOverviewQuery } from "@/server/modules/billing";
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
};

async function DeferredTopBar({ props, inboxItemsPromise }: { props: TopBarProps; inboxItemsPromise: Promise<Awaited<ReturnType<typeof getInboxItems>>> }) {
  const inboxItems = await inboxItemsPromise;
  return <TopBar {...props} inboxItems={inboxItems} />;
}

export async function DashboardShell({ context, children }: { context: DashboardContext; children: ReactNode }) {
  const { workspace, product } = context;
  const billing = workspace ? await getBillingOverviewQuery(workspace.id).catch(() => null) : null;
  const topBarProps = workspace && product ? {
    workspaceId: workspace.id,
    productId: product.id,
    productName: product.name,
    productDomain: domainFromUrl(product.website_url),
    userInitial: (context.userEmail?.[0] ?? "U").toUpperCase(),
    currentPlan: billing?.effectivePlan ?? "free",
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
          <UserAccount email={context.userEmail} />
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand"><LogoMark /> wanterest</div>
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
