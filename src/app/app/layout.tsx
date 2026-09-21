import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/modules/auth";

export const dynamic = "force-dynamic";

/**
 * Root layout for everything under /app — authentication only. It intentionally does
 * not render the dashboard shell or apply onboarding gating: /app/setup/* renders
 * bare (no sidebar) here, while the product route group and Settings each add their
 * own shell (and, for the product group, the onboarding redirect) below this.
 */
export default async function AppRootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
