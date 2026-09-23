import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { getCurrentUser } from "@/server/modules/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set new password",
  robots: { index: false, follow: false },
};

export default async function UpdatePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/forgot-password?error=invalid_link");

  return (
    <main>
      <AuthShell eyebrow="SET NEW PASSWORD">
        <UpdatePasswordForm />
      </AuthShell>
    </main>
  );
}
