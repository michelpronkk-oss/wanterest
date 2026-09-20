import { redirect } from "next/navigation";

import { WorkspaceSetupForm } from "@/components/onboarding/setup-forms";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

export default async function WorkspaceSetupPage() {
  const { workspace } = await getDashboardContext();
  if (workspace) redirect("/app/setup/product");
  return (
    <section className="dashboard-page onboarding-page">
      <p className="dashboard-eyebrow">First setup</p>
      <h1>Create your workspace.</h1>
      <p className="dashboard-subtitle">Start with a private workspace for your demand intelligence.</p>
      <div className="dashboard-panel onboarding-panel"><WorkspaceSetupForm /></div>
    </section>
  );
}
