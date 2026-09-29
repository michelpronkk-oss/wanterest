import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { requestPasswordRecovery } from "@/server/actions";

export const metadata: Metadata = { title: "Password recovery" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const params = await searchParams;
  return <AuthShell eyebrow="ACCOUNT RECOVERY" title="Reset your password." description="We’ll send a secure recovery link if an account matches that address." footer={<span>For security, the page gives the same confirmation whether or not an account exists.</span>}>
    {params.sent === "1" ? <p className="auth-success" role="status">If an administrator account matches that address, a recovery link is on its way.</p> : <>
      {params.error && <p className="auth-alert" role="alert">{params.error === "unavailable" ? "Password recovery is not configured for this preview." : "Enter a valid email address and try again."}</p>}
      <form action={requestPasswordRecovery} className="auth-form"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} autoCapitalize="none" /><AuthSubmitButton pendingLabel="Sending link…">Send recovery link <span aria-hidden="true">→</span></AuthSubmitButton></form>
    </>}
    <Link className="back-link" href="/login"><span aria-hidden="true">←</span> Back to sign in</Link>
  </AuthShell>;
}
