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
  cardKind?: ShareCardSnapshot["cardKind"];
  claim?: string | null;
  evidence?: string | null;
  evidenceStrength?: string | null;
  contextLabel?: string | null;
  freshnessLabel?: string | null;
  sourceLabel?: string | null;
}): ShareCardSnapshot {
  return {
    ...input,
    cardKind: input.cardKind ?? "identity",
    claim: input.claim ?? null,
    evidence: input.evidence ?? null,
    evidenceStrength: input.evidenceStrength ?? null,
    contextLabel: input.contextLabel ?? null,
    freshnessLabel: input.freshnessLabel ?? null,
    sourceLabel: input.sourceLabel ?? null,
  };
}

const INTELLIGENCE_VARIANTS = new Set(["SIGNAL", "DEMAND_GAP", "DEMAND_DRIFT"]);

function dateLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : `Observed ${date.toISOString().slice(0, 10)}`;
}

function evidenceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 320) : null;
}

function measurementQuality(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sampleQuality = (value as RawRecord).sampleQuality;
  return typeof sampleQuality === "string" && sampleQuality.trim() ? sampleQuality.trim().slice(0, 120) : null;
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
  getWorkspaceIntelligenceCard?(input: {
    workspaceId: string;
    productId: string;
    variant: "SIGNAL" | "DEMAND_GAP" | "DEMAND_DRIFT";
    sourceId: string;
  }): Promise<ShareCardAuthority>;
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

    async getWorkspaceIntelligenceCard(input) {
      const { data: product, error: productError } = await client.from("products")
        .select("id,workspace_id,status")
        .eq("id", input.productId)
        .eq("workspace_id", input.workspaceId)
        .eq("status", "active")
        .maybeSingle();
      if (productError) throw new AppError("INTERNAL_ERROR", "The product sharing authority could not be checked.", 500, { providerMessage: productError.message });
      if (!product) throw new AppError("FORBIDDEN", "Only an active product can publish an intelligence card.");

      if (!INTELLIGENCE_VARIANTS.has(input.variant)) throw new AppError("VALIDATION_ERROR", "The intelligence card variant is invalid.");

      if (input.variant === "SIGNAL") {
        const { data: signal, error } = await client.from("signals")
          .select("id,workspace_id,product_id,evidence_node_id,lifecycle_status,source_key,excerpt,why_it_matters,published_at,created_at,product_match_evaluation_id")
          .eq("id", input.sourceId)
          .eq("workspace_id", input.workspaceId)
          .eq("product_id", input.productId)
          .in("lifecycle_status", ["active", "saved"])
          .maybeSingle();
        if (error) throw new AppError("INTERNAL_ERROR", "The signal sharing authority could not be checked.", 500, { providerMessage: error.message });
        if (!signal) throw new AppError("FORBIDDEN", "Only a current signal can be published.");
        const evaluation = await client.from("product_match_evaluations")
          .select("decision")
          .eq("id", signal.product_match_evaluation_id)
          .maybeSingle();
        const decision = evaluation.data && typeof evaluation.data.decision === "string" ? evaluation.data.decision : "current";
        return {
          ownerKind: "workspace",
          ownerId: input.workspaceId,
          workspaceId: input.workspaceId,
          waitlistApplicationId: null,
          variant: input.variant,
          productId: input.productId,
          sourceId: input.sourceId,
          sourceEvidenceNodeId: signal.evidence_node_id,
          snapshot: snapshot({
            displayName: "Wanterest intelligence",
            headline: "A current, evidence-backed conversation signal",
            identityLabel: "Observed signal",
            identityNumber: null,
            tone: "signal",
            isPermanent: false,
            cardKind: "intelligence",
            claim: evidenceText(signal.excerpt),
            evidence: evidenceText(signal.why_it_matters) ?? evidenceText(signal.excerpt),
            evidenceStrength: decision === "qualified" ? "Qualified match evidence" : `${decision.replace(/^./, (char) => char.toUpperCase())} match evidence`,
            contextLabel: "Current product-scoped observation",
            freshnessLabel: dateLabel(signal.published_at ?? signal.created_at),
            sourceLabel: text(signal.source_key),
          }),
        };
      }

      if (input.variant === "DEMAND_GAP") {
        const { data: gap, error } = await client.from("demand_gaps")
          .select("id,workspace_id,product_id,evidence_node_id,concept_key,interpretation,market_mentions,measurement_metadata,demand_snapshot_id")
          .eq("id", input.sourceId)
          .eq("workspace_id", input.workspaceId)
          .eq("product_id", input.productId)
          .maybeSingle();
        if (error) throw new AppError("INTERNAL_ERROR", "The demand-gap sharing authority could not be checked.", 500, { providerMessage: error.message });
        if (!gap) throw new AppError("FORBIDDEN", "Only an existing evidence-backed demand gap can be published.");
        const snapshotRow = await client.from("demand_snapshots").select("period_end").eq("id", gap.demand_snapshot_id).eq("workspace_id", input.workspaceId).eq("product_id", input.productId).maybeSingle();
        return {
          ownerKind: "workspace", ownerId: input.workspaceId, workspaceId: input.workspaceId, waitlistApplicationId: null,
          variant: input.variant, productId: input.productId, sourceId: input.sourceId, sourceEvidenceNodeId: gap.evidence_node_id,
          snapshot: snapshot({
            displayName: "Wanterest intelligence", headline: "A recorded demand-gap analysis",
            identityLabel: text(gap.concept_key) ?? "Demand gap", identityNumber: null, tone: "gap", isPermanent: false,
            cardKind: "intelligence", claim: evidenceText(gap.interpretation),
            evidence: typeof gap.market_mentions === "number" ? `${gap.market_mentions} mention${gap.market_mentions === 1 ? "" : "s"} recorded in the analyzed snapshot.` : "Recorded in the analyzed demand snapshot.",
            evidenceStrength: measurementQuality(gap.measurement_metadata) ?? "Evidence-backed snapshot analysis",
            contextLabel: "Product-scoped demand gap · recorded analysis",
            freshnessLabel: dateLabel(snapshotRow.data?.period_end), sourceLabel: "Wanterest demand analysis",
          }),
        };
      }

      const { data: drift, error } = await client.from("demand_drifts")
        .select("id,workspace_id,product_id,evidence_node_id,concept_key,drift_direction,significance,current_mentions,previous_mentions,share_delta,growth_rate,current_snapshot_id,previous_snapshot_id")
        .eq("id", input.sourceId)
        .eq("workspace_id", input.workspaceId)
        .eq("product_id", input.productId)
        .maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "The demand-drift sharing authority could not be checked.", 500, { providerMessage: error.message });
      if (!drift) throw new AppError("FORBIDDEN", "Only an existing evidence-backed demand drift can be published.");
      const currentSnapshot = await client.from("demand_snapshots").select("period_end").eq("id", drift.current_snapshot_id).eq("workspace_id", input.workspaceId).eq("product_id", input.productId).maybeSingle();
      const previousSnapshot = await client.from("demand_snapshots").select("period_end").eq("id", drift.previous_snapshot_id).eq("workspace_id", input.workspaceId).eq("product_id", input.productId).maybeSingle();
      const direction = text(drift.drift_direction) ?? "movement";
      return {
        ownerKind: "workspace", ownerId: input.workspaceId, workspaceId: input.workspaceId, waitlistApplicationId: null,
        variant: input.variant, productId: input.productId, sourceId: input.sourceId, sourceEvidenceNodeId: drift.evidence_node_id,
        snapshot: snapshot({
          displayName: "Wanterest intelligence", headline: "A recorded demand-movement analysis",
          identityLabel: text(drift.concept_key) ?? "Demand movement", identityNumber: null, tone: "drift", isPermanent: false,
          cardKind: "intelligence", claim: `${direction.charAt(0).toUpperCase()}${direction.slice(1)} movement was recorded for this concept.`,
          evidence: typeof drift.current_mentions === "number" && typeof drift.previous_mentions === "number" ? `${drift.current_mentions} current mentions versus ${drift.previous_mentions} in the comparison period.` : "Recorded in the comparable demand snapshots.",
          evidenceStrength: text(drift.significance) ? `${String(drift.significance).charAt(0).toUpperCase()}${String(drift.significance).slice(1)} comparison evidence` : "Comparable snapshot evidence",
          contextLabel: "Product-scoped demand movement · recorded analysis",
          freshnessLabel: dateLabel(currentSnapshot.data?.period_end) ?? dateLabel(previousSnapshot.data?.period_end),
          sourceLabel: "Wanterest demand analysis",
        }),
      };
    },
  };
}
