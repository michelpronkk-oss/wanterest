import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { toPublicError } from "@/server/lib/errors";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await loadDashboardContext();
  return <DashboardShell context={context}>{children}</DashboardShell>;
}

async function loadDashboardContext() {
  try {
    return await getDashboardContext();
  } catch (error) {
    if (toPublicError(error).code === "UNAUTHENTICATED") redirect("/login");
    throw error;
  }
}
