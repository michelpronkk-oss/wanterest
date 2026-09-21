import { redirect } from "next/navigation";

import { getDashboardContext, resolveOnboardingStep } from "@/server/modules/dashboard/dashboard.context";

export default async function SetupPage() {
  const context = await getDashboardContext();
  redirect(resolveOnboardingStep(context) ?? "/app/setup/scan");
}
