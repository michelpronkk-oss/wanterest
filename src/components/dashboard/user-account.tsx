import { logoutAction } from "@/app/auth-actions";

export function UserAccount({ email }: { email: string | null }) {
  return (
    <div className="dashboard-account">
      <div className="dashboard-account-identity">
        <span className="dashboard-account-avatar" aria-hidden="true">{(email?.[0] ?? "U").toUpperCase()}</span>
        <span title={email ?? undefined}>{email ?? "Signed-in user"}</span>
      </div>
      <form action={logoutAction}>
        <button className="dashboard-signout" type="submit">Sign out</button>
      </form>
    </div>
  );
}
