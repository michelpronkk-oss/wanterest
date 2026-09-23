"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SITE_ORIGIN, startPathForWebsite } from "@/shared/config/site";
import { clientAuthErrorMessage, isExistingSignupAccount } from "@/shared/auth/client-errors";
import { loginPathForSite } from "@/components/marketing/links";
import { authCallbackUrl } from "./auth-callback-url";
import { PasswordField } from "./password-field";

export function SignupForm({ websiteUrl = null }: { websiteUrl?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const submitLockRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setError(null);
    setMessage(null);
    setExistingAccount(false);
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authCallbackUrl(startPathForWebsite(websiteUrl), websiteUrl) },
      });

      if (authError) {
        setError(clientAuthErrorMessage("signup", authError));
        setIsSubmitting(false);
        submitLockRef.current = false;
        return;
      }

      if (isExistingSignupAccount(data.user)) {
        setExistingAccount(true);
        setMessage("An account with this email already exists. Log in or reset your password.");
        setIsSubmitting(false);
        submitLockRef.current = false;
        return;
      }

      if (data.session) {
        router.replace(startPathForWebsite(websiteUrl));
        router.refresh();
        return;
      }

      setMessage("Check your email to confirm your account, then log in to continue.");
      setIsSubmitting(false);
      submitLockRef.current = false;
    } catch (authError) {
      setError(clientAuthErrorMessage("signup", authError));
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
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
        {message ? <p className={existingAccount ? "auth-error" : "auth-success"} role={existingAccount ? "alert" : "status"}>{message}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>

        <p className="auth-hint">No credit card required.</p>
        <p className="auth-hint">
          By creating an account, you agree to the{" "}
          <a href={`${SITE_ORIGIN}/terms`} target="_blank" rel="noopener noreferrer">Terms</a> and acknowledge the{" "}
          <a href={`${SITE_ORIGIN}/privacy`} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </p>
      </form>

      <p className="auth-switch">Already have an account? <Link href={loginPathForSite(websiteUrl)}>Log in</Link></p>
    </>
  );
}
