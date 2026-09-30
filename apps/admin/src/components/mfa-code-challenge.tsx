"use client";

import { useState } from "react";
import { verifyMfa } from "@admin/server/actions";
import { AuthSubmitButton } from "@admin/components/auth-submit-button";

type FactorOption = { id: string; friendlyName: string };

export function MfaCodeChallenge({ factors }: { factors: FactorOption[] }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    const result = await verifyMfa(formData);
    if (!result.ok) setError(result.message);
  }

  return <form action={submit} className="auth-form">
    {factors.length > 1 && <>
      <label htmlFor="factorId">Authenticator</label>
      <select name="factorId" id="factorId">
        {factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendlyName}</option>)}
      </select>
    </>}
    {factors.length === 1 && <input type="hidden" name="factorId" value={factors[0].id} />}
    <label htmlFor="challenge-code">Verification code</label>
    <input id="challenge-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required />
    <AuthSubmitButton pendingLabel="Verifying…">Verify and continue <span aria-hidden="true">→</span></AuthSubmitButton>
    {error && <p className="auth-alert" role="alert">{error}</p>}
  </form>;
}
