import Link from "next/link";
import type { ReactNode } from "react";

import type { DashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { ContextSwitchers } from "./context-switchers";
import { DashboardNav } from "./dashboard-nav";
import { UserAccount } from "./user-account";
import { TopBar } from "./top-bar";
import { LogoMark } from "./nav-icons";
import { getInboxItems } from "./inbox";
import { domainFromUrl } from "./dashboard-utils";

export async function DashboardShell({ context, children }: { context: DashboardContext; children: ReactNode }) {
  const { workspace, product } = context;
  const inboxItems = workspace && product ? await getInboxItems(workspace.id, product.id).catch(() => []) : [];

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
        {workspace && product ? (
          <TopBar
            workspaceId={workspace.id}
            productId={product.id}
            productName={product.name}
            productDomain={domainFromUrl(product.website_url)}
            userInitial={(context.userEmail?.[0] ?? "U").toUpperCase()}
            inboxItems={inboxItems}
          />
        ) : null}
        {children}
      </main>
    </div>
  );
}
