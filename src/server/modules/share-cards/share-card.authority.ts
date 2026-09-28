import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createWaitlistService } from "@/server/modules/waitlist";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { shareCardVariantSchema, type ShareCardAuthority, type ShareCardSnapshot } from "./share-card.schemas";

type RawRecord = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

function snapshot(input: {
  displayName: string;
  headline: string | null;
  identityLabel: string;
  identityNumber: number | null;
  tone: ShareCardSnapshot["tone"];
  isPermanent: boolean;
}): ShareCardSnapshot {
  return input;
}

function applicantCards(applicationId: string, earlyAccessNumber: number, priorityGranted: boolean): ShareCardAuthority[] {
  const cards: ShareCardAuthority[] = [{
    ownerKind: "applicant",
    ownerId: applicationId,
    workspaceId: null,
    waitlistApplicationId: applicationId,
    variant: "EARLY_ACCESS",
    snapshot: snapshot({
      displayName: "Wanterest member",
      headline: "Verified Early Access identity",
      identityLabel: "Early Access",
      identityNumber: earlyAccessNumber,
      tone: "neutral",
      isPermanent: true,
    }),
  }];
  if (priorityGranted) cards.push({
    ownerKind: "applicant",
    ownerId: applicationId,
    workspaceId: null,
    waitlistApplicationId: applicationId,
    variant: "PRIORITY_ACCESS",
    snapshot: snapshot({
      displayName: "Wanterest member",
      headline: "Currently granted waitlist priority",
      identityLabel: "Priority Access",
      identityNumber: null,
      tone: "priority",
      isPermanent: false,
    }),
  });
  return cards;
}

export type ShareCardAuthorityAdapter = {
  getApplicantCards(statusToken: string): Promise<ShareCardAuthority[]>;
  authorizeWorkspace(workspaceId: string, userId: string): Promise<void>;
  getWorkspaceCards(workspaceId: string): Promise<ShareCardAuthority[]>;
};

export function createSupabaseShareCardAuthorityAdapter(): ShareCardAuthorityAdapter {
  const client = createSupabaseServiceClient() as unknown as SupabaseClient;
  return {
    async getApplicantCards(statusToken) {
      const status = await createWaitlistService().statusWithReferral(statusToken);
      const earlyAccessNumber = number(status.application.earlyAccessNumber);
      if (status.application.emailVerificationStatus !== "verified" || !earlyAccessNumber) return [];
      return applicantCards(status.application.id, earlyAccessNumber, status.referral?.priorityStatus === "granted");
    },

    async authorizeWorkspace(workspaceId, userId) {
      const { data, error } = await client.from("workspace_members")
        .select("role,status")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "Workspace share permissions could not be checked.", 500, { providerMessage: error.message });
      if (!data || data.status !== "active" || !["owner", "admin"].includes(data.role)) {
        throw new AppError("FORBIDDEN", "Only an active workspace owner or admin can publish a share card.");
      }
    },

    async getWorkspaceCards(workspaceId) {
      const [{ data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
        client.from("workspace_cohort_memberships").select("id,cohort,cohort_number").eq("workspace_id", workspaceId).maybeSingle(),
        client.from("workspace_public_cohort_profiles").select("cohort_membership_id,display_name,headline,pass_visible").eq("workspace_id", workspaceId).maybeSingle(),
      ]);
      if (membershipError || profileError) throw new AppError("INTERNAL_ERROR", "Workspace share identity could not be loaded.", 500, { providerMessage: membershipError?.message ?? profileError?.message });
      const membershipRow = membership as RawRecord | null;
      const profileRow = profile as RawRecord | null;
      if (!membershipRow || !profileRow || profileRow.pass_visible !== true || profileRow.cohort_membership_id !== membershipRow.id) return [];
      const cohort = membershipRow.cohort;
      const variant = shareCardVariantSchema.safeParse(cohort === "founding_25" ? "FOUNDING_25" : cohort === "early_100" ? "EARLY_100" : "");
      const cohortNumber = number(membershipRow.cohort_number);
      const displayName = text(profileRow.display_name);
      if (!variant.success || !cohortNumber || !displayName) return [];
      return [{
        ownerKind: "workspace",
        ownerId: workspaceId,
        workspaceId,
        waitlistApplicationId: null,
        variant: variant.data,
        snapshot: snapshot({
          displayName,
          headline: text(profileRow.headline),
          identityLabel: cohort === "founding_25" ? "Founding 25" : "Early 100",
          identityNumber: cohortNumber,
          tone: cohort === "founding_25" ? "founding" : "early",
          isPermanent: true,
        }),
      }];
    },
  };
}
