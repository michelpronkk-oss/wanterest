import { redirect } from "next/navigation";
import { createAdminServiceClient, createAdminSessionClient } from "@admin/server/supabase";
import { MfaEnrollment } from "@admin/components/mfa-enrollment";
import { MfaCodeChallenge } from "@admin/components/mfa-code-challenge";
import { AuthShell } from "@admin/components/auth-shell";
import { findPendingAdminTotp, logMfaFailure } from "@admin/server/mfa-flow";

export default async function MfaRequiredPage() {
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

  const { data: factors, error: factorError } = await session.auth.mfa.listFactors();
  if (factorError || !factors) logMfaFailure("factor_list", factorError);
  const verified = factors?.totp.filter((factor) => factor.status === "verified") ?? [];
  const pending = factors ? findPendingAdminTotp(factors.totp) : [];

  return <AuthShell eyebrow="SECURITY CHECK" title={verified.length ? "Verify your identity." : "Set up your authenticator."} description="Admin access requires a verified authenticator before any operational data is shown." footer={<span>Your sign-in is protected by Wanterest’s access policy and verified TOTP MFA.</span>}>
    {verified.length > 0
      ? <MfaCodeChallenge factors={verified.map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name || "Authenticator" }))} />
      : factorError || !factors
        ? <MfaEnrollment initialState="unavailable" />
        : pending.length > 1
          ? <MfaEnrollment initialState="multiple-pending" />
          : pending.length === 1
            ? <MfaEnrollment initialState="pending" pendingFactorId={pending[0].id} />
            : <MfaEnrollment />}
  </AuthShell>;
}
