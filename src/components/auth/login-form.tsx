"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm() {
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

    router.replace("/app");
    router.refresh();
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-wordmark" aria-label="Wanterest">
        <span className="auth-wordmark-mark" aria-hidden="true">W</span>
        <span>Wanterest</span>
      </div>
      <div className="auth-heading">
        <p className="auth-eyebrow">Demand intelligence</p>
        <h1 id="login-title">Welcome back.</h1>
        <p>Sign in to continue to your workspace.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Email</span>
          <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isSubmitting} />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isSubmitting} />
        </label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
