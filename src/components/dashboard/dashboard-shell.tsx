import Link from "next/link";
import type { ReactNode } from "react";

import type { DashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { ContextSwitchers } from "./context-switchers";
import { DashboardNav } from "./dashboard-nav";
import { UserAccount } from "./user-account";

export function DashboardShell({ context, children }: { context: DashboardContext; children: ReactNode }) {
  return (
    <div className="dashboard-app">
      <aside className="dashboard-sidebar">
        <Link className="dashboard-logo" href="/app" aria-label="Wanterest overview">
          <span className="dashboard-logo-mark" aria-hidden="true">W</span>
          <span>Wanterest</span>
        </Link>
        <ContextSwitchers {...context} />
        <DashboardNav />
        <div className="dashboard-sidebar-footer">
          <span className="dashboard-status-dot" aria-hidden="true" />
          <span>Intelligence workspace</span>
          <UserAccount email={context.userEmail} />
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand"><span className="dashboard-logo-mark" aria-hidden="true">W</span> Wanterest</div>
        {children}
      </main>
    </div>
  );
}
