import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/server/actions";
import { AuthShell } from "@/components/auth-shell";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { isAdminAuthConfigured } from "@/server/supabase";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; password?: string }> }) {
  const params = await searchParams;
  const configured = isAdminAuthConfigured();
  return (
    <AuthShell eyebrow="PRIVATE OPERATIONS" title="Welcome back." description="Sign in with your Wanterest administrator account." footer={<span>Need access? It is provisioned privately by the Wanterest team.</span>}>
      {params.error === "credentials" && <p className="auth-alert" role="alert">We couldn’t verify that sign-in. Check your details and admin access.</p>}
      {params.error === "mfa" && <p className="auth-alert" role="alert">A verified authenticator is required for admin access.</p>}
      {params.error === "recovery" && <p className="auth-alert" role="alert">Password recovery is unavailable right now. Try again later.</p>}
      {params.password === "updated" && <p className="auth-success" role="status">Your password has been updated. Sign in to continue.</p>}
      {!configured && <p className="auth-notice" role="status">Sign-in is not configured in this local preview. No production credentials are exposed here.</p>}
      <form action={signIn} className="auth-form">
        <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} autoCapitalize="none" />
        <div className="field-heading"><label htmlFor="password">Password</label><Link href="/forgot-password">Forgot password?</Link></div><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        <AuthSubmitButton pendingLabel="Signing in…">Continue <span aria-hidden="true">→</span></AuthSubmitButton>
      </form>
      <p className="auth-security-note"><span className="security-dot" aria-hidden="true" />Private access is protected by explicit admin approval and a verified authenticator.</p>
    </AuthShell>
  );
}
