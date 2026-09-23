import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { authCallbackErrorMessage } from "@/shared/auth/callback";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const rawWebsite = typeof query.website === "string" ? query.website : null;
  const websiteUrl = tryNormalizePublicWebsiteUrl(rawWebsite);
  const callbackError = authCallbackErrorMessage(typeof query.error === "string" ? query.error : null);

  return (
    <main>
      <AuthShell eyebrow="RESET PASSWORD">
        <ForgotPasswordForm websiteUrl={websiteUrl} initialError={callbackError} />
      </AuthShell>
    </main>
  );
}
