"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { startMfaEnrollment, verifyMfa } from "@/server/actions";
import { AuthSubmitButton } from "@/components/auth-submit-button";

export function MfaEnrollment() {
  const [setup, setSetup] = useState<{ factorId: string; qrCode: string } | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function beginEnrollment() {
    setError(false);
    startTransition(async () => {
      const result = await startMfaEnrollment();
      if (!result.ok || !result.qrCode || !result.factorId) {
        setError(true);
        return;
      }
      setSetup({ factorId: result.factorId, qrCode: result.qrCode });
    });
  }

  return <div className="mfa-setup">
    <p className="login-note">Use an authenticator app to scan a private setup code. Then verify its first code to finish sign-in.</p>
    {!setup ? <button className="secondary-button" disabled={pending} onClick={beginEnrollment} type="button">{pending ? <><span className="button-spinner" aria-hidden="true" />Preparing secure setup…</> : <>Set up authenticator <span aria-hidden="true">→</span></>}</button> : <>
      <div className="qr-frame"><Image src={setup.qrCode} alt="Authenticator setup QR code" width={190} height={190} unoptimized /></div>
      <p className="setup-hint">Scan this code with your authenticator app. It is shown only in this signed-in setup session.</p>
      <form action={verifyMfa} className="auth-form"><input type="hidden" name="factorId" value={setup.factorId} /><label htmlFor="setup-code">Verification code</label><input id="setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required /><AuthSubmitButton pendingLabel="Verifying…">Verify authenticator <span aria-hidden="true">→</span></AuthSubmitButton></form>
    </>}
    {error && <p className="auth-alert" role="alert">Authenticator setup is unavailable. Check the Supabase Auth connection and try again.</p>}
  </div>;
}
