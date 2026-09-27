export const priorityReferralPolicy = {
  policyKey: "priority_referral_v1",
  threshold: 3,
} as const;

export type PriorityAccessStatus = "normal" | "granted" | "revoked";

export type WaitlistReferralReadModel = {
  shareUrl: string | null;
  verifiedCount: number;
  threshold: number;
  remainingCount: number;
  priorityStatus: PriorityAccessStatus;
  priorityUnlocked: boolean;
  priorityGrantedAt: string | null;
};

export function priorityReadModel(input: {
  verifiedCount: number;
  priorityStatus: PriorityAccessStatus;
  priorityGrantedAt: string | null;
}, shareUrl: string | null): WaitlistReferralReadModel {
  return {
    shareUrl,
    verifiedCount: input.verifiedCount,
    threshold: priorityReferralPolicy.threshold,
    remainingCount: Math.max(0, priorityReferralPolicy.threshold - input.verifiedCount),
    priorityStatus: input.priorityStatus,
    priorityUnlocked: input.priorityStatus === "granted",
    priorityGrantedAt: input.priorityGrantedAt,
  };
}
