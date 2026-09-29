"use client";

import { useFormStatus } from "react-dom";

export function AuthSubmitButton({ children, pendingLabel = "Please wait…" }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button className="auth-submit" type="submit" disabled={pending} aria-live="polite">
    {pending ? <><span className="button-spinner" aria-hidden="true" />{pendingLabel}</> : children}
  </button>;
}
