import { redirect } from "next/navigation";
import { createAdminServiceClient, createAdminSessionClient } from "@/server/supabase";
import { verifyMfa } from "@/server/actions";
import { MfaEnrollment } from "@/components/mfa-enrollment";
import { AuthShell } from "@/components/auth-shell";
import { AuthSubmitButton } from "@/components/auth-submit-button";

export default async function MfaRequiredPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await createAdminSessionClient();
  if (!session) redirect("/login");
  const { data: userData, error: userError } = await session.auth.getUser();
  if (userError || !userData.user) redirect("/login");
  const service = createAdminServiceClient();
  if (!service) redirect("/login");
  const { data: membership, error: membershipError } = await service.from("admin_memberships")
    .select("user_id").eq("user_id", userData.user.id).eq("status", "active").maybeSingle();
  if (membershipError || !membership) redirect("/login?error=credentials");
  const { data: assurance, error: assuranceError } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assuranceError && assurance.currentLevel === "aal2") redirect("/");
  const { data: factors } = await session.auth.mfa.listFactors();
  const verified = factors?.totp.filter((factor) => factor.status === "verified") ?? [];
  const params = await searchParams;
  return <AuthShell eyebrow="SECURITY CHECK" title={verified.length ? "Verify your identity." : "Set up your authenticator."} description="Admin access requires a verified authenticator before any operational data is shown." footer={<span>Your sign-in is protected by Wanterest’s access policy and verified TOTP MFA.</span>}>
    {params.error === "mfa" && <p className="auth-alert" role="alert">That code could not be verified. Try again with a current code.</p>}
    {verified.length > 0 ? <form action={verifyMfa} className="auth-form"><label htmlFor="factorId">Authenticator</label><select name="factorId" id="factorId">{verified.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || "Authenticator"}</option>)}</select><label htmlFor="code" className="spaced-label">Verification code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required /><AuthSubmitButton pendingLabel="Verifying…">Verify and continue <span aria-hidden="true">→</span></AuthSubmitButton></form> : <MfaEnrollment />}
  </AuthShell>;
}
