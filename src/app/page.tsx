import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MarketingHome } from "@/components/marketing/marketing-home";
import { getCurrentUser } from "@/server/modules/auth";
import { isAppHost } from "@/shared/config/site";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();

  // app.wanterest.com/ is the auth/onboarding surface: send it to the product or the login
  // screen. www.wanterest.com/ (and any other host, e.g. local dev) is always the marketing
  // homepage — authenticated visitors must still be able to load it, so it is never redirected.
  if (isAppHost(requestHeaders.get("host"))) {
    const user = await getCurrentUser();
    redirect(user ? "/app" : "/login");
  }

  return <MarketingHome />;
}
