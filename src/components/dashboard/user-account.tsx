"use client";

import { useFormStatus } from "react-dom";

import { logoutAction } from "@/app/auth-actions";

function LogoutButton() {
  const { pending } = useFormStatus();

  return (
    <button className="dashboard-signout" type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function UserAccount({ email }: { email: string | null }) {
  return (
    <div className="dashboard-account">
      <div className="dashboard-account-identity">
        <span className="dashboard-account-avatar" aria-hidden="true">{(email?.[0] ?? "U").toUpperCase()}</span>
        <span title={email ?? undefined}>{email ?? "Signed-in user"}</span>
      </div>
      <form action={logoutAction}>
        <LogoutButton />
      </form>
    </div>
  );
}
