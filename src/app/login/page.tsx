import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/server/modules/auth";
import { startPathForWebsite } from "@/shared/config/site";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const rawWebsite = typeof query.website === "string" ? query.website : null;
  const websiteUrl = tryNormalizePublicWebsiteUrl(rawWebsite);
  const user = await getCurrentUser();
  if (user) redirect(websiteUrl ? startPathForWebsite(websiteUrl) : "/app");

  return (
    <main>
      <AuthShell eyebrow="WELCOME BACK">
        <LoginForm websiteUrl={websiteUrl} />
      </AuthShell>
    </main>
  );
}
