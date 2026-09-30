export const ADMIN_TOTP_FRIENDLY_NAME = "Wanterest Admin";

export type MfaFailureStage = "factor_list" | "enrollment" | "challenge" | "verification";
export type MfaFailureReason =
  | "pending_factor"
  | "multiple_pending"
  | "configuration"
  | "rate_limited"
  | "session_expired"
  | "code_rejected"
  | "factor_missing"
  | "unavailable";

type AuthMfaError = { code?: string; status?: number } | null | undefined;
export type TotpFactorSummary = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
};

export function findPendingAdminTotp(factors: readonly TotpFactorSummary[]) {
  return factors.filter((factor) =>
    factor.factor_type === "totp" &&
    factor.status === "unverified" &&
    factor.friendly_name === ADMIN_TOTP_FRIENDLY_NAME
  );
}

export function classifyMfaFailure(error: AuthMfaError, stage: MfaFailureStage): MfaFailureReason {
  if (error?.code === "mfa_factor_name_conflict" && stage === "enrollment") return "pending_factor";
  if (error?.code === "mfa_verification_failed" && stage === "verification") return "code_rejected";
  if (
    error?.code === "mfa_factor_not_enabled" ||
    error?.code === "mfa_factor_enrollment_not_enabled" ||
    error?.code === "mfa_verification_not_enabled"
  ) return "configuration";
  if (error?.status === 429) return "rate_limited";
  if (error?.status === 401 || error?.status === 403) return "session_expired";
  if (error?.status === 404) return "factor_missing";
  if ((error?.status === 400 || error?.status === 422) && stage === "verification") return "code_rejected";
  return "unavailable";
}

export function safeMfaFailureMessage(reason: MfaFailureReason, stage: MfaFailureStage) {
  switch (reason) {
    case "pending_factor":
      return "An authenticator setup is already in progress. We kept the existing setup. Refresh to resume it; do not start a new setup.";
    case "multiple_pending":
      return "More than one unfinished Wanterest Admin setup exists. No new factor was created. Contact the Wanterest operator to review it.";
    case "configuration":
      return "Supabase Auth could not complete this MFA step. Ask the Wanterest operator to confirm TOTP enrollment and verification are enabled.";
    case "rate_limited":
      return "There have been too many MFA attempts. Wait a few minutes, then try again.";
    case "session_expired":
      return "Your sign-in session has expired. Return to the login page and sign in again.";
    case "factor_missing":
      return "This authenticator setup is no longer available. Refresh the page and sign in again. If setup is still pending, contact the Wanterest operator.";
    case "code_rejected":
      return "That code was not accepted. Enter a current code from the Wanterest Admin entry in your authenticator app and check that your device clock is correct.";
    default:
      return stage === "enrollment"
        ? "Authenticator setup could not be prepared. Try refreshing. If the problem continues, ask the Wanterest operator to check the production Supabase Auth connection."
        : "The authenticator service could not complete this step. Try again shortly. If the problem continues, ask the Wanterest operator to check production Supabase Auth.";
  }
}

export function logMfaFailure(stage: MfaFailureStage, error: AuthMfaError) {
  const reason = classifyMfaFailure(error, stage);
  const status = typeof error?.status === "number" && Number.isInteger(error.status) ? error.status : undefined;

  // Never log user identifiers, factor IDs, codes, QR payloads, secrets, tokens, or raw Auth messages.
  console.warn("admin_mfa_operation_failed", { stage, reason, status });
  return reason;
}
