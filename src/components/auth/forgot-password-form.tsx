"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { loginPathForSite } from "@/components/marketing/links";
import { clientAuthErrorMessage } from "@/shared/auth/client-errors";
import { authCallbackUrl } from "./auth-callback-url";

export function ForgotPasswordForm({ websiteUrl = null, initialError = null }: { websiteUrl?: string | null; initialError?: string | null }) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authCallbackUrl("/forgot-password/update", websiteUrl),
      });

      if (authError) {
        setError(clientAuthErrorMessage("reset", authError));
        setIsSubmitting(false);
        return;
      }

      setMessage("Check your email for a link to reset your password.");
      setIsSubmitting(false);
    } catch (authError) {
      setError(clientAuthErrorMessage("reset", authError));
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <p className="auth-card-eyebrow">RESET PASSWORD</p>
      <h1 className="auth-card-title" id="forgot-password-title">Reset your password.</h1>
      <p className="auth-card-sub">Enter your email and we’ll send you a link to reset it.</p>

      <form className="auth-form" onSubmit={submit} aria-labelledby="forgot-password-title">
        <div className="auth-field">
          <div className="auth-field-label-row">
            <label htmlFor="forgot-password-email">Email</label>
          </div>
          <div className="auth-input-wrap">
            <input
              id="forgot-password-email"
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

        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-success" role="status">{message}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="auth-switch">Remembered it? <Link href={loginPathForSite(websiteUrl)}>Log in</Link></p>
    </>
  );
}
