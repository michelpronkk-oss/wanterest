import { z } from "zod";

import type { Database, Json } from "./database.types";

type PublicTables = Database["public"]["Tables"];

export type WorkspaceRow = PublicTables["workspaces"]["Row"];
export type WorkspaceMemberRow = PublicTables["workspace_members"]["Row"];
export type WorkspaceEntitlementRow = PublicTables["workspace_entitlements"]["Row"];
export type UsageLedgerRow = PublicTables["usage_ledger"]["Row"];
export type AuditLogRow = PublicTables["audit_log"]["Row"];
export type EngineVersionRow = PublicTables["engine_versions"]["Row"];
export type EngineVersionInsert = PublicTables["engine_versions"]["Insert"];
export type EngineVersionUpdate = PublicTables["engine_versions"]["Update"];

export type JobRunRow = PublicTables["job_runs"]["Row"];
export type JobRunInsert = PublicTables["job_runs"]["Insert"];
export type JobRunUpdate = PublicTables["job_runs"]["Update"];

export type EvidenceNodeRow = PublicTables["evidence_nodes"]["Row"];
export type EvidenceNodeInsert = PublicTables["evidence_nodes"]["Insert"];
export type EvidenceNodeUpdate = PublicTables["evidence_nodes"]["Update"];

export type RawSourceItemRow = PublicTables["raw_source_items"]["Row"];
export type RawSourceItemInsert = PublicTables["raw_source_items"]["Insert"];
export type RawSourceItemUpdate = PublicTables["raw_source_items"]["Update"];

export type SourceItemRow = PublicTables["source_items"]["Row"];
export type SourceItemInsert = PublicTables["source_items"]["Insert"];
export type SourceItemUpdate = PublicTables["source_items"]["Update"];

export type ConversationRow = PublicTables["conversations"]["Row"];
export type ConversationInsert = PublicTables["conversations"]["Insert"];
export type ConversationUpdate = PublicTables["conversations"]["Update"];

export type ConversationSourceItemRow = PublicTables["conversation_source_items"]["Row"];
export type ConversationSourceItemInsert = PublicTables["conversation_source_items"]["Insert"];
export type ConversationSourceItemUpdate = PublicTables["conversation_source_items"]["Update"];

export type SourceHealthRow = PublicTables["source_health"]["Row"];
export type SourceHealthInsert = PublicTables["source_health"]["Insert"];
export type SourceHealthUpdate = PublicTables["source_health"]["Update"];

export type EvidenceProvenanceRow = PublicTables["evidence_provenance"]["Row"];
export type EvidenceProvenanceInsert = PublicTables["evidence_provenance"]["Insert"];
export type EvidenceProvenanceUpdate = PublicTables["evidence_provenance"]["Update"];

export type ProductRow = PublicTables["products"]["Row"];
export type ProductInsert = PublicTables["products"]["Insert"];
export type ProductUpdate = PublicTables["products"]["Update"];
export type ProductSnapshotRow = PublicTables["product_snapshots"]["Row"];
export type ProductSnapshotInsert = PublicTables["product_snapshots"]["Insert"];
export type ProductSnapshotUpdate = PublicTables["product_snapshots"]["Update"];
export type DemandProfileRow = PublicTables["demand_profiles"]["Row"];
export type DemandProfileInsert = PublicTables["demand_profiles"]["Insert"];
export type DemandProfileUpdate = PublicTables["demand_profiles"]["Update"];
export type DemandProfileSnapshotInputRow = PublicTables["demand_profile_snapshot_inputs"]["Row"];
export type DemandProfileSnapshotInputInsert = PublicTables["demand_profile_snapshot_inputs"]["Insert"];
export type DiscoveryStrategyRow = PublicTables["discovery_strategies"]["Row"];
export type DiscoveryStrategyInsert = PublicTables["discovery_strategies"]["Insert"];
export type DiscoveryStrategyUpdate = PublicTables["discovery_strategies"]["Update"];
export type ConversationAnalysisRow = PublicTables["conversation_analysis"]["Row"];
export type ConversationAnalysisInsert = PublicTables["conversation_analysis"]["Insert"];
export type ConversationAnalysisEvidenceRow = PublicTables["conversation_analysis_evidence"]["Row"];
export type ConversationAnalysisEvidenceInsert = PublicTables["conversation_analysis_evidence"]["Insert"];
export type ProductMatchRow = PublicTables["product_matches"]["Row"];
export type ProductMatchInsert = PublicTables["product_matches"]["Insert"];
export type ProductMatchUpdate = PublicTables["product_matches"]["Update"];
export type ProductMatchEvaluationRow = PublicTables["product_match_evaluations"]["Row"];
export type ProductMatchEvaluationInsert = PublicTables["product_match_evaluations"]["Insert"];
export type MatchRankingRow = PublicTables["match_rankings"]["Row"];
export type MatchRankingInsert = PublicTables["match_rankings"]["Insert"];
export type SignalRow = PublicTables["signals"]["Row"];
export type SignalInsert = PublicTables["signals"]["Insert"];
export type SignalUpdate = PublicTables["signals"]["Update"];
export type MatchFeedbackRow = PublicTables["match_feedback"]["Row"];
export type MatchFeedbackInsert = PublicTables["match_feedback"]["Insert"];

// Phase 4 demand-intelligence persistence aliases. These must remain direct
// projections of the generated Supabase schema; domain modules add stricter
// validation separately at their boundaries.
export type DemandObservationRow = PublicTables["demand_observations"]["Row"];
export type DemandObservationInsert = PublicTables["demand_observations"]["Insert"];
export type DemandObservationUpdate = PublicTables["demand_observations"]["Update"];
export type DemandThemeRow = PublicTables["demand_themes"]["Row"];
export type DemandThemeInsert = PublicTables["demand_themes"]["Insert"];
export type DemandThemeUpdate = PublicTables["demand_themes"]["Update"];
export type ThemeMembershipRow = PublicTables["theme_memberships"]["Row"];
export type ThemeMembershipInsert = PublicTables["theme_memberships"]["Insert"];
export type ThemeMembershipUpdate = PublicTables["theme_memberships"]["Update"];
export type DemandSnapshotRow = PublicTables["demand_snapshots"]["Row"];
export type DemandSnapshotInsert = PublicTables["demand_snapshots"]["Insert"];
export type DemandSnapshotUpdate = PublicTables["demand_snapshots"]["Update"];
export type DemandSnapshotThemeRow = PublicTables["demand_snapshot_themes"]["Row"];
export type DemandSnapshotThemeInsert = PublicTables["demand_snapshot_themes"]["Insert"];
export type DemandSnapshotThemeUpdate = PublicTables["demand_snapshot_themes"]["Update"];
export type DemandSnapshotPhraseRow = PublicTables["demand_snapshot_phrases"]["Row"];
export type DemandSnapshotPhraseInsert = PublicTables["demand_snapshot_phrases"]["Insert"];
export type DemandSnapshotPhraseUpdate = PublicTables["demand_snapshot_phrases"]["Update"];
export type DemandSnapshotAlternativeRow = PublicTables["demand_snapshot_alternatives"]["Row"];
export type DemandSnapshotAlternativeInsert = PublicTables["demand_snapshot_alternatives"]["Insert"];
export type DemandSnapshotAlternativeUpdate = PublicTables["demand_snapshot_alternatives"]["Update"];
export type DemandSnapshotIntentRow = PublicTables["demand_snapshot_intents"]["Row"];
export type DemandSnapshotIntentInsert = PublicTables["demand_snapshot_intents"]["Insert"];
export type DemandSnapshotIntentUpdate = PublicTables["demand_snapshot_intents"]["Update"];
export type DemandGapRow = PublicTables["demand_gaps"]["Row"];
export type DemandGapInsert = PublicTables["demand_gaps"]["Insert"];
export type DemandGapUpdate = PublicTables["demand_gaps"]["Update"];
export type DemandDriftRow = PublicTables["demand_drifts"]["Row"];
export type DemandDriftInsert = PublicTables["demand_drifts"]["Insert"];
export type DemandDriftUpdate = PublicTables["demand_drifts"]["Update"];
export type DemandDriftPhraseRow = PublicTables["demand_drift_phrases"]["Row"];
export type DemandDriftPhraseInsert = PublicTables["demand_drift_phrases"]["Insert"];
export type DemandDriftPhraseUpdate = PublicTables["demand_drift_phrases"]["Update"];
export type DemandDriftAlternativeRow = PublicTables["demand_drift_alternatives"]["Row"];
export type DemandDriftAlternativeInsert = PublicTables["demand_drift_alternatives"]["Insert"];
export type DemandDriftAlternativeUpdate = PublicTables["demand_drift_alternatives"]["Update"];

// Phase 5 action and digest persistence aliases.
export type ActionRow = PublicTables["actions"]["Row"];
export type ActionInsert = PublicTables["actions"]["Insert"];
export type ActionUpdate = PublicTables["actions"]["Update"];
export type ActionVariantRow = PublicTables["action_variants"]["Row"];
export type ActionVariantInsert = PublicTables["action_variants"]["Insert"];
export type ActionVariantUpdate = PublicTables["action_variants"]["Update"];
export type ActionFeedbackRow = PublicTables["action_feedback"]["Row"];
export type ActionFeedbackInsert = PublicTables["action_feedback"]["Insert"];
export type ActionFeedbackUpdate = PublicTables["action_feedback"]["Update"];
export type ActionEventRow = PublicTables["action_events"]["Row"];
export type ActionEventInsert = PublicTables["action_events"]["Insert"];
export type ActionEventUpdate = PublicTables["action_events"]["Update"];
export type DigestRow = PublicTables["digests"]["Row"];
export type DigestInsert = PublicTables["digests"]["Insert"];
export type DigestUpdate = PublicTables["digests"]["Update"];
export type DigestItemRow = PublicTables["digest_items"]["Row"];
export type DigestItemInsert = PublicTables["digest_items"]["Insert"];
export type DigestItemUpdate = PublicTables["digest_items"]["Update"];

// Phase 7 persistence aliases are direct projections of the regenerated
// Supabase schema. Domain modules validate stricter contracts separately.
export type ExperimentRow = PublicTables["experiments"]["Row"];
export type ExperimentInsert = PublicTables["experiments"]["Insert"];
export type ExperimentUpdate = PublicTables["experiments"]["Update"];
export type ExperimentVariantRow = PublicTables["experiment_variants"]["Row"];
export type ExperimentVariantInsert = PublicTables["experiment_variants"]["Insert"];
export type ExperimentVariantUpdate = PublicTables["experiment_variants"]["Update"];
export type ExperimentAssignmentRow = PublicTables["experiment_assignments"]["Row"];
export type ExperimentAssignmentInsert = PublicTables["experiment_assignments"]["Insert"];
export type ExperimentAssignmentUpdate = PublicTables["experiment_assignments"]["Update"];
export type ExperimentEventRow = PublicTables["experiment_events"]["Row"];
export type ExperimentEventInsert = PublicTables["experiment_events"]["Insert"];
export type ExperimentEventUpdate = PublicTables["experiment_events"]["Update"];
export type ExperimentResultRow = PublicTables["experiment_results"]["Row"];
export type ExperimentResultInsert = PublicTables["experiment_results"]["Insert"];
export type ExperimentResultUpdate = PublicTables["experiment_results"]["Update"];
export type ExperimentPublicTokenRow = PublicTables["experiment_public_tokens"]["Row"];
export type ExperimentPublicTokenInsert = PublicTables["experiment_public_tokens"]["Insert"];
export type ExperimentPublicTokenUpdate = PublicTables["experiment_public_tokens"]["Update"];
export type SourceControlRow = PublicTables["source_controls"]["Row"];
export type SourceControlInsert = PublicTables["source_controls"]["Insert"];
export type SourceControlUpdate = PublicTables["source_controls"]["Update"];
export type RateLimitBucketRow = PublicTables["rate_limit_buckets"]["Row"];
export type RateLimitBucketInsert = PublicTables["rate_limit_buckets"]["Insert"];
export type RateLimitBucketUpdate = PublicTables["rate_limit_buckets"]["Update"];

// Phase 6 billing persistence aliases. Keep these as direct projections of
// the generated Supabase schema; billing/domain modules validate provider and
// product semantics separately at their boundaries.
export type BillingCustomerRow = PublicTables["billing_customers"]["Row"];
export type BillingCustomerInsert = PublicTables["billing_customers"]["Insert"];
export type BillingCustomerUpdate = PublicTables["billing_customers"]["Update"];
export type SubscriptionRow = PublicTables["subscriptions"]["Row"];
export type SubscriptionInsert = PublicTables["subscriptions"]["Insert"];
export type SubscriptionUpdate = PublicTables["subscriptions"]["Update"];
export type BillingCheckoutRequestRow = PublicTables["billing_checkout_requests"]["Row"];
export type BillingCheckoutRequestInsert = PublicTables["billing_checkout_requests"]["Insert"];
export type BillingCheckoutRequestUpdate = PublicTables["billing_checkout_requests"]["Update"];
export type BillingWebhookEventRow = PublicTables["billing_webhook_events"]["Row"];
export type BillingWebhookEventInsert = PublicTables["billing_webhook_events"]["Insert"];
export type BillingWebhookEventUpdate = PublicTables["billing_webhook_events"]["Update"];

export type BillingPlan = SubscriptionRow["internal_plan"];
export type BillingInterval = SubscriptionRow["billing_interval"];
export type NormalizedSubscriptionStatus = SubscriptionRow["status"];
export type BillingWebhookProcessingStatus = BillingWebhookEventRow["processing_status"];

export type ActionType = ActionRow["action_type"];
export type ActionTriggerType = ActionRow["trigger_type"];
export type ActionStatus = ActionRow["status"];
export type ActionVariantStatus = ActionVariantRow["status"];
export type ActionFeedbackType = ActionFeedbackRow["feedback_type"];
export type ActionEventType = ActionEventRow["event_type"];
export type DigestType = DigestRow["digest_type"];
export type DigestStatus = DigestRow["status"];
export type DigestItemType = DigestItemRow["item_type"];

export type WorkspaceMemberRole = WorkspaceMemberRow["role"];
export type UsageType = UsageLedgerRow["usage_type"];

export type { Json } from "./database.types";
export type JsonObject = { [key: string]: Json | undefined };

/** JSON values accepted by PostgreSQL jsonb columns. */
export const jsonValueSchema = z.json();
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
