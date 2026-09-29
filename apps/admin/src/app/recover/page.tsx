import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@admin/components/auth-shell";
import { AuthSubmitButton } from "@admin/components/auth-submit-button";
import { completePasswordRecovery } from "@admin/server/actions";
import { createAdminSessionClient } from "@admin/server/supabase";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await createAdminSessionClient();
  if (!session) redirect("/login?error=recovery");
  const { data } = await session.auth.getUser();
  if (!data.user) redirect("/login?error=recovery");
  const params = await searchParams;
  return <AuthShell eyebrow="SECURE RECOVERY" title="Choose a new password." description="Use at least 12 characters. You’ll sign in again after updating it." footer={<span>Recovery links expire and can only be used once.</span>}>
    {params.error && <p className="auth-alert" role="alert">{params.error === "expired" ? "This recovery link has expired. Request a new one." : "We couldn’t update that password. Check both fields and try again."}</p>}
    <form action={completePasswordRecovery} className="auth-form"><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><label htmlFor="confirmation" className="spaced-label">Confirm new password</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><AuthSubmitButton pendingLabel="Updating password…">Update password <span aria-hidden="true">→</span></AuthSubmitButton></form>
    <Link className="back-link" href="/login"><span aria-hidden="true">←</span> Back to sign in</Link>
  </AuthShell>;
}
