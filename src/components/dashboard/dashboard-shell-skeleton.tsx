import Link from "next/link";

import { DashboardNav } from "./dashboard-nav";
import { LogoMark } from "./nav-icons";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardShellSkeleton() {
  return (
    <div className="dashboard-app" role="status" aria-live="polite" aria-label="Loading dashboard">
      <aside className="dashboard-sidebar">
        <Link className="dashboard-logo" href="/app" aria-label="Wanterest overview">
          <span className="dashboard-logo-mark" aria-hidden="true"><LogoMark /></span>
          <span>wanterest</span>
        </Link>
        <div style={{ display: "grid", gap: 8, padding: "16px 12px 20px" }} aria-hidden="true">
          <Skeleton height={12} width="72%" />
          <Skeleton height={16} width="88%" />
        </div>
        <DashboardNav />
        <div className="dashboard-sidebar-footer" aria-hidden="true">
          <Skeleton height={32} width="100%" />
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="dashboard-mobile-brand"><LogoMark /> wanterest</div>
        <div className="dashboard-topbar" aria-hidden="true">
          <Skeleton height={38} width="min(360px, 45%)" />
          <Skeleton height={32} width={180} />
        </div>
        <DashboardPageSkeleton />
      </main>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <section className="dashboard-page" aria-hidden="true">
      <div className="dashboard-page-header">
        <Skeleton height={12} width={82} />
        <div style={{ marginTop: 10 }}><Skeleton height={30} width="min(300px, 65%)" /></div>
        <div style={{ marginTop: 10 }}><Skeleton height={14} width="min(520px, 90%)" /></div>
      </div>
      <div className="dashboard-grid dashboard-grid-2">
        <div className="ui-card ui-card-pad"><Skeleton height={22} width="38%" /><div style={{ marginTop: 16 }}><Skeleton height={70} /></div></div>
        <div className="ui-card ui-card-pad"><Skeleton height={22} width="44%" /><div style={{ marginTop: 16 }}><Skeleton height={70} /></div></div>
      </div>
      <div style={{ marginTop: 16 }} className="ui-card ui-card-pad"><Skeleton height={18} width="28%" /><div style={{ marginTop: 16, display: "grid", gap: 10 }}><Skeleton height={14} /><Skeleton height={14} width="78%" /><Skeleton height={14} width="60%" /></div></div>
    </section>
  );
}
