import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import type { PriorityAccessStatus } from "./referral.policy";

export type RawWaitlistReferralStatus = {
  referralCode: string | null;
  verifiedCount: number;
  priorityStatus: PriorityAccessStatus;
  priorityGrantedAt: string | null;
};

export type WaitlistReferralRepository = {
  getStatus(applicationId: string): Promise<RawWaitlistReferralStatus>;
  invalidate(referralId: string, reason: string, actorUserId?: string | null): Promise<void>;
  revokePriority(applicationId: string, reason: string, actorUserId?: string | null): Promise<void>;
};

type RawRecord = Record<string, unknown>;

function serviceClient(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

function unwrap<T>(data: T | null, error: { message?: string } | null): T {
  if (error || data === null) throw new AppError("INTERNAL_ERROR", "Referral persistence failed.", 500, error ? { providerMessage: error.message } : undefined);
  return data;
}

function optionalText(value: unknown): string | null { return typeof value === "string" ? value : null; }

function status(row: RawRecord): RawWaitlistReferralStatus {
  const priorityStatus = row.priority_status;
  if (priorityStatus !== "normal" && priorityStatus !== "granted" && priorityStatus !== "revoked") throw new AppError("INTERNAL_ERROR", "Referral priority state is invalid.");
  return {
    referralCode: optionalText(row.referral_code),
    verifiedCount: typeof row.verified_count === "number" ? row.verified_count : Number(row.verified_count ?? 0),
    priorityStatus,
    priorityGrantedAt: optionalText(row.priority_granted_at),
  };
}

export function createSupabaseWaitlistReferralRepository(client: SupabaseClient = serviceClient()): WaitlistReferralRepository {
  return {
    async getStatus(applicationId) {
      const { data, error } = await client.rpc("get_waitlist_referral_status", { p_application_id: applicationId });
      return status(unwrap(data as RawRecord | null, error));
    },
    async invalidate(referralId, reason, actorUserId = null) {
      const { error } = await client.rpc("invalidate_waitlist_referral", { p_referral_id: referralId, p_reason: reason, p_actor_user_id: actorUserId });
      if (error) throw new AppError("INTERNAL_ERROR", "Referral invalidation failed.", 500, { providerMessage: error.message });
    },
    async revokePriority(applicationId, reason, actorUserId = null) {
      const { error } = await client.rpc("revoke_waitlist_priority_access", { p_application_id: applicationId, p_reason: reason, p_actor_user_id: actorUserId });
      if (error) throw new AppError("INTERNAL_ERROR", "Priority revocation failed.", 500, { providerMessage: error.message });
    },
  };
}
