"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { startMfaEnrollment, verifyMfa } from "@admin/server/actions";
import { AuthSubmitButton } from "@admin/components/auth-submit-button";

type Setup = { factorId: string; qrCode: string };
type InitialState = "new" | "pending" | "multiple-pending" | "unavailable";

export function MfaEnrollment({
  initialState = "new",
  pendingFactorId,
}: {
  initialState?: InitialState;
  pendingFactorId?: string;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [factorId, setFactorId] = useState(pendingFactorId ?? null);
  const [state, setState] = useState<InitialState>(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function beginEnrollment() {
    setMessage(null);
    startTransition(async () => {
      const result = await startMfaEnrollment();
      if (!result.ok) {
        setState(result.reason === "multiple_pending" ? "multiple-pending" : "unavailable");
        setMessage(result.message);
        return;
      }
      if (result.mode === "resume") {
        setState("pending");
        setFactorId(result.factorId);
        setMessage("An authenticator setup is already in progress. We kept the existing factor and did not create another one.");
        return;
      }
      setState("new");
      setSetup({ factorId: result.factorId, qrCode: result.qrCode });
      setFactorId(result.factorId);
    });
  }

  async function submitCode(formData: FormData) {
    setMessage(null);
    const result = await verifyMfa(formData);
    if (!result.ok) setMessage(result.message);
  }

  const hasPendingSetup = Boolean(setup || factorId);
  const canStart = state === "new" && !hasPendingSetup;

  return <div className="mfa-setup">
    <p className="login-note">Use an authenticator app to scan a private setup code. Then verify its first code to finish sign-in.</p>
    {setup && <>
      <div className="qr-frame"><Image src={setup.qrCode} alt="Authenticator setup QR code" width={190} height={190} unoptimized /></div>
      <p className="setup-hint">Scan this code with your authenticator app. It stays available while you retry verification in this setup session.</p>
    </>}
    {state === "pending" && !setup && <>
      <p className="setup-hint">An unfinished Wanterest Admin authenticator was found. If you already scanned its setup code, enter the current code from that authenticator. If you do not have that authenticator entry, pause here and contact the Wanterest operator to review the pending setup. Do not start another setup.</p>
    </>}
    {state === "multiple-pending" && <>
      <p className="setup-hint">More than one unfinished setup needs operator review. No factor was removed and no new factor was created.</p>
    </>}
    {state === "unavailable" && !message && <>
      <p className="setup-hint">We could not check whether an authenticator setup is already pending. Refresh this page before trying again so another factor is not created.</p>
    </>}
    {canStart && <button className="secondary-button" disabled={pending} onClick={beginEnrollment} type="button">{pending ? <><span className="button-spinner" aria-hidden="true" />Preparing secure setup…</> : <>Set up authenticator <span aria-hidden="true">→</span></>}</button>}
    {hasPendingSetup && factorId && <form action={submitCode} className="auth-form">
      <input type="hidden" name="factorId" value={factorId} />
      <label htmlFor="setup-code">Verification code</label>
      <input id="setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required />
      <AuthSubmitButton pendingLabel="Verifying…">Verify authenticator <span aria-hidden="true">→</span></AuthSubmitButton>
    </form>}
    {message && <p className="auth-alert" role="alert">{message}</p>}
  </div>;
}
