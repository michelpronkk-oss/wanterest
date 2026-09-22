"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { startPathForWebsite } from "@/shared/config/site";
import { loginUrlForSite } from "@/components/marketing/links";
import { authCallbackUrl } from "./auth-callback-url";
import { PasswordField } from "./password-field";

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
      options: { emailRedirectTo: authCallbackUrl(startPathForWebsite(websiteUrl), websiteUrl) },
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
    <>
      <p className="auth-card-eyebrow">DEMAND INTELLIGENCE</p>
      <h1 className="auth-card-title" id="signup-title">Start finding real demand.</h1>
      <p className="auth-card-sub">Create your account and scan your first product.</p>

      <form className="auth-form" onSubmit={submit} aria-labelledby="signup-title">
        <div className="auth-field">
          <div className="auth-field-label-row">
            <label htmlFor="signup-email">Email</label>
          </div>
          <div className="auth-input-wrap">
            <input
              id="signup-email"
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
          autoComplete="new-password"
          placeholder="Create a password"
          value={password}
          onChange={setPassword}
          required
          minLength={6}
          disabled={isSubmitting}
          error={Boolean(error)}
        />

        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-success" role="status">{message}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>

        <p className="auth-hint">No credit card required.</p>
      </form>

      <p className="auth-switch">Already have an account? <Link href={loginUrlForSite(websiteUrl)}>Log in</Link></p>
    </>
  );
}
