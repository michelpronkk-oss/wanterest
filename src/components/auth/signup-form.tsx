"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { APP_ORIGIN, startPathForWebsite } from "@/shared/config/site";
import { loginUrlForSite } from "@/components/marketing/links";

function authCallbackUrl(websiteUrl: string | null): string {
  const url = new URL("/auth/callback", APP_ORIGIN);
  url.searchParams.set("next", startPathForWebsite(websiteUrl));
  if (websiteUrl) url.searchParams.set("website", websiteUrl);
  return url.toString();
}

export function SignupForm({ websiteUrl = null }: { websiteUrl?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authCallbackUrl(websiteUrl) },
    });

    if (authError) {
      setError("We couldn’t create your account. Check your details and try again.");
      setIsSubmitting(false);
      return;
    }

    if (data.session) {
      router.replace(startPathForWebsite(websiteUrl));
      router.refresh();
      return;
    }

    setMessage("Check your email to confirm your account, then log in to continue.");
    setIsSubmitting(false);
  }

  return (
    <section className="auth-card" aria-labelledby="signup-title">
      <div className="auth-wordmark" aria-label="Wanterest">
        <span className="auth-wordmark-mark" aria-hidden="true">W</span>
        <span>Wanterest</span>
      </div>
      <div className="auth-heading">
        <p className="auth-eyebrow">Demand intelligence</p>
        <h1 id="signup-title">Start finding real demand.</h1>
        <p>Create your account and scan your first product.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Email</span>
          <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isSubmitting} />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input autoComplete="new-password" type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isSubmitting} />
        </label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-success" role="status">{message}</p> : null}
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">Already have an account? <Link href={loginUrlForSite(websiteUrl)}>Log in</Link></p>
    </section>
  );
}
