import { redirect } from "next/navigation";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

export default async function SetupPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) redirect("/app/setup/workspace");
  if (!product) redirect("/app/setup/product");
  if (!product.current_snapshot_id || !product.current_demand_profile_id) redirect("/app/setup/product");
  redirect("/app/setup/scan");
}
