import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import type { WaitlistStatus } from "./waitlist.schemas";

export type WaitlistApplication = {
  id: string;
  publicId: string;
  earlyAccessNumber: number | null;
  email: string;
  normalizedEmail: string;
  firstName: string;
  companyName: string;
  companyWebsite: string | null;
  roleTitle: string | null;
  useCase: string;
  status: WaitlistStatus;
  emailVerificationStatus: "pending" | "verified";
  verifiedAt: string | null;
  withdrawnAt: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerCategory: string | null;
  marketingConsent: boolean;
  transactionalEmailAllowed: boolean;
  convertedUserId: string | null;
  convertedWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WaitlistSubmissionRecord = WaitlistApplication;

export type WaitlistReviewFilter = { status?: WaitlistStatus; page: number; pageSize: number; search?: string };

export type WaitlistRepository = {
  submit(input: {
    email: string;
    normalizedEmail: string;
    firstName: string;
    companyName: string;
    companyWebsite: string | null;
    roleTitle: string | null;
    useCase: string;
    verificationTokenHash: string;
    verificationExpiresAt: string;
    statusTokenHash: string;
    source: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    referrerCategory: string | null;
    referralCode?: string | null;
    marketingConsent: boolean;
  }): Promise<WaitlistSubmissionRecord>;
  verify(verificationTokenHash: string): Promise<WaitlistApplication>;
  getByStatusToken(statusTokenHash: string): Promise<WaitlistApplication>;
  withdraw(statusTokenHash: string): Promise<WaitlistApplication>;
  listForReview(filter: WaitlistReviewFilter): Promise<{ rows: WaitlistApplication[]; total: number }>;
  transitionForReview(input: { applicationId: string; toStatus: Exclude<WaitlistStatus, "pending" | "verified">; actorUserId: string; reason?: string }): Promise<WaitlistApplication>;
};

type RawWaitlistApplication = Record<string, unknown>;

function text(row: RawWaitlistApplication, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new AppError("INTERNAL_ERROR", `Waitlist record is missing ${key}.`);
  return value;
}

function optionalText(row: RawWaitlistApplication, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function application(row: RawWaitlistApplication): WaitlistApplication {
  const status = text(row, "status") as WaitlistStatus;
  if (!(["pending", "verified", "under_review", "approved_for_invite", "declined", "withdrawn"] as string[]).includes(status)) {
    throw new AppError("INTERNAL_ERROR", "Waitlist record has an invalid status.");
  }
  return {
    id: text(row, "id"), publicId: text(row, "public_id"),
    earlyAccessNumber: typeof row.early_access_number === "number" ? row.early_access_number : row.early_access_number === null ? null : Number(row.early_access_number),
    email: text(row, "email"), normalizedEmail: text(row, "normalized_email"), firstName: text(row, "first_name"), companyName: text(row, "company_name"),
    companyWebsite: optionalText(row, "company_website"), roleTitle: optionalText(row, "role_title"), useCase: text(row, "use_case"), status,
    emailVerificationStatus: text(row, "email_verification_status") as "pending" | "verified", verifiedAt: optionalText(row, "verified_at"), withdrawnAt: optionalText(row, "withdrawn_at"),
    source: optionalText(row, "source"), utmSource: optionalText(row, "utm_source"), utmMedium: optionalText(row, "utm_medium"), utmCampaign: optionalText(row, "utm_campaign"), utmContent: optionalText(row, "utm_content"), utmTerm: optionalText(row, "utm_term"), referrerCategory: optionalText(row, "referrer_category"),
    marketingConsent: row.marketing_consent === true, transactionalEmailAllowed: row.transactional_email_allowed !== false,
    convertedUserId: optionalText(row, "converted_user_id"), convertedWorkspaceId: optionalText(row, "converted_workspace_id"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function serviceClient(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

function unwrap<T>(data: T | null, error: { message?: string } | null): T {
  if (error || !data) throw new AppError("INTERNAL_ERROR", "Waitlist persistence failed.", 500, error ? { providerMessage: error.message } : undefined);
  return data;
}

export function createSupabaseWaitlistRepository(client: SupabaseClient = serviceClient()): WaitlistRepository {
  return {
    async submit(input) {
      const { data, error } = await client.rpc("submit_waitlist_application_with_referral", {
        p_email: input.email, p_normalized_email: input.normalizedEmail, p_first_name: input.firstName, p_company_name: input.companyName,
        p_company_website: input.companyWebsite, p_role_title: input.roleTitle, p_use_case: input.useCase, p_verification_token_hash: input.verificationTokenHash,
        p_verification_expires_at: input.verificationExpiresAt, p_status_token_hash: input.statusTokenHash, p_source: input.source, p_utm_source: input.utmSource,
        p_utm_medium: input.utmMedium, p_utm_campaign: input.utmCampaign, p_utm_content: input.utmContent, p_utm_term: input.utmTerm, p_referrer_category: input.referrerCategory,
        p_marketing_consent: input.marketingConsent, p_referral_code: input.referralCode ?? null,
      });
      return application(unwrap(data as RawWaitlistApplication | null, error));
    },
    async verify(verificationTokenHash) {
      const { data, error } = await client.rpc("verify_waitlist_application", { p_verification_token_hash: verificationTokenHash });
      return application(unwrap(data as RawWaitlistApplication | null, error));
    },
    async getByStatusToken(statusTokenHash) {
      const { data, error } = await client.rpc("get_waitlist_application_by_status_token", { p_status_token_hash: statusTokenHash });
      return application(unwrap(data as RawWaitlistApplication | null, error));
    },
    async withdraw(statusTokenHash) {
      const { data, error } = await client.rpc("withdraw_waitlist_application", { p_status_token_hash: statusTokenHash });
      return application(unwrap(data as RawWaitlistApplication | null, error));
    },
    async listForReview(filter) {
      let query = client.from("waitlist_applications").select("*", { count: "exact" });
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.search) query = query.or(`email.ilike.%${filter.search}%,company_name.ilike.%${filter.search}%`);
      const from = (filter.page - 1) * filter.pageSize;
      const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + filter.pageSize - 1);
      if (error) throw new AppError("INTERNAL_ERROR", "Waitlist review data could not be loaded.", 500, { providerMessage: error.message });
      return { rows: (data ?? []).map((row) => application(row as RawWaitlistApplication)), total: count ?? 0 };
    },
    async transitionForReview(input) {
      const { data, error } = await client.rpc("transition_waitlist_application", { p_application_id: input.applicationId, p_to_status: input.toStatus, p_actor_user_id: input.actorUserId, p_reason: input.reason ?? null });
      return application(unwrap(data as RawWaitlistApplication | null, error));
    },
  };
}
