import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { getCurrentUser } from "@/server/modules/auth";
import { startPathForWebsite } from "@/shared/config/site";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const rawWebsite = typeof query.website === "string" ? query.website : null;
  const websiteUrl = tryNormalizePublicWebsiteUrl(rawWebsite);
  const user = await getCurrentUser();
  if (user) redirect(startPathForWebsite(websiteUrl));

  return (
    <main>
      <AuthShell eyebrow="DEMAND INTELLIGENCE">
        <SignupForm websiteUrl={websiteUrl} />
      </AuthShell>
    </main>
  );
}
