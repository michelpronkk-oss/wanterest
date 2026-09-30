"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { restartMfaEnrollment, startMfaEnrollment, verifyMfa } from "@admin/server/actions";
import { AuthSubmitButton } from "@admin/components/auth-submit-button";

type Setup = { factorId: string; qrCode: string };
type PendingFactor = { id: string; createdAt?: string };
type InitialState = "new" | "pending" | "multiple-pending" | "unavailable";

export function MfaEnrollment({
  initialState = "new",
  pendingFactors: initialPendingFactors = [],
}: {
  initialState?: InitialState;
  pendingFactors?: PendingFactor[];
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pendingFactors, setPendingFactors] = useState(initialPendingFactors);
  const [state, setState] = useState<InitialState>(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const [restartingFactorId, setRestartingFactorId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function applyEnrollmentResult(result: Awaited<ReturnType<typeof startMfaEnrollment>>) {
    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setMessage(result.mode === "setup" ? null : result.notice ?? null);
    if (result.mode === "setup") {
      setState("new");
      setPendingFactors([]);
      setRestartingFactorId(null);
      setSetup({ factorId: result.factorId, qrCode: result.qrCode });
    } else if (result.mode === "resume") {
      setSetup(null);
      setState("pending");
      setPendingFactors([{ id: result.factorId }]);
      setRestartingFactorId(null);
      if (!result.notice) {
        setMessage("An unfinished Wanterest Admin setup was found. Enter its current code, or restart it explicitly if you no longer have its QR code.");
      }
    } else {
      setSetup(null);
      setState("multiple-pending");
      setPendingFactors(result.factorIds.map((id) => ({ id })));
      setRestartingFactorId(null);
      if (!result.notice) {
        setMessage("Several unfinished setups exist. Choose the authenticator you scanned, or restart only the setup whose QR code you lost.");
      }
    }
  }

  function beginEnrollment() {
    setMessage(null);
    startTransition(async () => {
      const result = await startMfaEnrollment();
      applyEnrollmentResult(result);
    });
  }

  async function submitCode(formData: FormData) {
    setMessage(null);
    const result = await verifyMfa(formData);
    if (!result.ok) setMessage(result.message);
  }

  async function restartSetup(formData: FormData) {
    setMessage(null);
    const result = await restartMfaEnrollment(formData);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    applyEnrollmentResult(result);
    if (result.mode !== "setup" && !result.notice) {
      setMessage("The selected unfinished setup was removed. Choose a remaining setup, or start a new one when none remain.");
    }
  }

  const canStart = (state === "new" || state === "unavailable") && !setup && pendingFactors.length === 0;

  return <div className="mfa-setup">
    <p className="login-note">Use an authenticator app to scan a private setup code. Then verify its first code to finish sign-in.</p>
    {setup && <>
      <div className="qr-frame"><Image src={setup.qrCode} alt="Authenticator setup QR code" width={190} height={190} unoptimized /></div>
      <p className="setup-hint">Scan this code with your authenticator app. It stays available in this session while you retry verification.</p>
      <form action={submitCode} className="auth-form">
        <input type="hidden" name="factorId" value={setup.factorId} />
        <label htmlFor="new-setup-code">Verification code</label>
        <input id="new-setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required />
        <AuthSubmitButton pendingLabel="Verifying…">Verify authenticator <span aria-hidden="true">→</span></AuthSubmitButton>
      </form>
    </>}
    {pendingFactors.length > 0 && <div className="pending-setups" aria-label="Unfinished authenticator setups">
      {pendingFactors.map((factor, index) => {
        const codeInputId = "pending-setup-code-" + (index + 1);
        const confirmInputId = "confirm-restart-" + (index + 1);
        return <section className="pending-setup" key={factor.id}>
          <h2 className="pending-setup-title">
            {pendingFactors.length > 1 ? "Unfinished setup " + (index + 1) : "Unfinished authenticator setup"}
          </h2>
          {factor.createdAt && <p className="pending-setup-date">Created {factor.createdAt.slice(0, 10)}</p>}
          <p className="setup-hint">If you scanned this setup’s QR code, enter its current authenticator code below. A new code is required for each attempt.</p>
          <form action={submitCode} className="auth-form">
            <input type="hidden" name="factorId" value={factor.id} />
            <label htmlFor={codeInputId}>Verification code</label>
            <input id={codeInputId} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required />
            <AuthSubmitButton pendingLabel="Verifying…">Verify authenticator <span aria-hidden="true">→</span></AuthSubmitButton>
          </form>
          {restartingFactorId !== factor.id
            ? <button className="text-button" type="button" onClick={() => { setMessage(null); setRestartingFactorId(factor.id); }}>
                Restart authenticator setup
              </button>
            : <form action={restartSetup} className="restart-confirmation">
                <input type="hidden" name="factorId" value={factor.id} />
                <label className="confirm-restart-label" htmlFor={confirmInputId}>
                  <input id={confirmInputId} type="checkbox" name="confirmRestart" value="yes" required />
                  I no longer have the QR code for this setup. Remove only this unfinished setup and create a replacement.
                </label>
                <div className="restart-actions">
                  <AuthSubmitButton pendingLabel="Restarting setup…">Confirm and restart setup</AuthSubmitButton>
                  <button className="text-button" type="button" onClick={() => setRestartingFactorId(null)}>Cancel</button>
                </div>
              </form>}
        </section>;
      })}
    </div>}
    {state === "unavailable" && !message && <>
      <p className="setup-hint">We could not confirm the current authenticator setup. Try again shortly. If the issue continues, ask the Wanterest operator to review the Supabase Auth connection.</p>
    </>}
    {canStart && <button className="secondary-button" disabled={pending} onClick={beginEnrollment} type="button">{pending ? <><span className="button-spinner" aria-hidden="true" />Preparing secure setup…</> : <>Set up authenticator <span aria-hidden="true">→</span></>}</button>}
    {message && <p className="auth-alert" role="alert">{message}</p>}
  </div>;
}
