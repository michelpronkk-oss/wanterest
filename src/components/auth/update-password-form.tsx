"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PasswordField } from "./password-field";

/** Reached via the /auth/callback code exchange from a Supabase password-reset email link,
    which establishes the recovery session this form updates. */
export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.updateUser({ password });

    if (authError) {
      setError("We couldn’t update your password. Request a new reset link and try again.");
      setIsSubmitting(false);
      return;
    }

    router.replace("/app");
    router.refresh();
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

        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </>
  );
}
