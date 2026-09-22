"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { forgotPasswordUrlForSite, signupUrlForSite } from "@/components/marketing/links";
import { startPathForWebsite } from "@/shared/config/site";
import { PasswordField } from "./password-field";

export function LoginForm({ websiteUrl = null }: { websiteUrl?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("We couldn’t sign you in with those credentials.");
      setIsSubmitting(false);
      return;
    }

    const destination = websiteUrl ? startPathForWebsite(websiteUrl) : "/app";
    router.replace(destination);
    router.refresh();
  }

  return (
    <>
      <p className="auth-card-eyebrow">WELCOME BACK</p>
      <h1 className="auth-card-title" id="login-title">Continue finding real demand.</h1>
      <p className="auth-card-sub">Log in to continue to your Wanterest workspace.</p>

      <form className="auth-form" onSubmit={submit} aria-labelledby="login-title">
        <div className="auth-field">
          <div className="auth-field-label-row">
            <label htmlFor="login-email">Email</label>
          </div>
          <div className="auth-input-wrap">
            <input
              id="login-email"
              className="auth-input"
              autoComplete="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isSubmitting}
              aria-invalid={Boolean(error) || undefined}
            />
          </div>
        </div>

        <PasswordField
          label="Password"
          labelExtra={<Link className="auth-field-forgot" href={forgotPasswordUrlForSite(websiteUrl)}>Forgot password?</Link>}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={setPassword}
          required
          disabled={isSubmitting}
          error={Boolean(error)}
        />

        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Log in"}
        </button>
      </form>

      <p className="auth-switch">New to Wanterest? <Link href={signupUrlForSite(websiteUrl)}>Start free</Link></p>
    </>
  );
}
