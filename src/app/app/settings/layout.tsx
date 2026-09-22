import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardShellSkeleton } from "@/components/dashboard/dashboard-shell-skeleton";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

/**
 * Settings remains reachable for product management even when a workspace has
 * no active product. The normal product route group still applies onboarding
 * readiness guards to the main dashboard.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<DashboardShellSkeleton />}>
      <SettingsLayoutContent>{children}</SettingsLayoutContent>
    </Suspense>
  );
}

async function SettingsLayoutContent({ children }: { children: ReactNode }) {
  const context = await getDashboardContext();
  if (!context.workspace) redirect("/app/setup/workspace");
  return <DashboardShell context={context}>{children}</DashboardShell>;
}
