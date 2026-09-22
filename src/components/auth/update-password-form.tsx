"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { clientAuthErrorMessage, passwordConfirmationError } from "@/shared/auth/client-errors";
import { PasswordField } from "./password-field";

/** Reached via the /auth/callback code exchange from a Supabase password-reset email link,
    which establishes the recovery session this form updates. */
export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const mismatchError = passwordConfirmationError(password, confirmation);
    if (mismatchError) {
      setError(mismatchError);
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.updateUser({ password });

      if (authError) {
        setError(clientAuthErrorMessage("update", authError));
        setIsSubmitting(false);
        return;
      }

      router.replace("/app");
      router.refresh();
    } catch (authError) {
      setError(clientAuthErrorMessage("update", authError));
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <p className="auth-card-eyebrow">SET NEW PASSWORD</p>
      <h1 className="auth-card-title" id="update-password-title">Choose a new password.</h1>
      <p className="auth-card-sub">You’ll be signed in to your workspace after this.</p>

      <form className="auth-form" onSubmit={submit} aria-labelledby="update-password-title">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          placeholder="Enter a new password"
          value={password}
          onChange={setPassword}
          required
          minLength={6}
          disabled={isSubmitting}
          error={Boolean(error)}
        />

        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Enter the new password again"
          value={confirmation}
          onChange={setConfirmation}
          required
          minLength={6}
          disabled={isSubmitting}
          error={Boolean(error) && Boolean(confirmation) && password !== confirmation}
        />

        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </>
  );
}
