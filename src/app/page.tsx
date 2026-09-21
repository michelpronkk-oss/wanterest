import { redirect } from "next/navigation";

import { MarketingHome } from "@/components/marketing/marketing-home";
import { getCurrentUser } from "@/server/modules/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/app");

  return <MarketingHome />;
}
