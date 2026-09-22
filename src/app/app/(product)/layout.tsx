import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardShellSkeleton } from "@/components/dashboard/dashboard-shell-skeleton";
import { getDashboardContext, resolveOnboardingStep } from "@/server/modules/dashboard/dashboard.context";

/**
 * Home / Signals / Saved / Insights / Actions / Experiments all live in this route
 * group. Authentication is already guaranteed by the root /app layout, so this layout's
 * only job is: redirect into onboarding if the active workspace/product isn't ready yet,
 * otherwise render the normal dashboard shell. Settings is deliberately outside this
 * group — it stays reachable (with the shell) regardless of onboarding state.
 */
export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<DashboardShellSkeleton />}>
      <ProductLayoutContent>{children}</ProductLayoutContent>
    </Suspense>
  );
}

async function ProductLayoutContent({ children }: { children: ReactNode }) {
  const context = await getDashboardContext();
  const onboardingStep = resolveOnboardingStep(context);
  if (onboardingStep) redirect(onboardingStep);
  return <DashboardShell context={context}>{children}</DashboardShell>;
}
