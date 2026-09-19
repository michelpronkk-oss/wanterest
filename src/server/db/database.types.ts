export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type WorkspaceStatus = "active" | "suspended" | "archived";
export type WorkspaceMemberRole = "owner" | "admin" | "member" | "viewer";
export type WorkspaceMemberStatus = "active" | "inactive";
export type UsageType =
  | "qualified_signal"
  | "source_scan"
  | "action_generated"
  | "experiment_created"
  | "export";
export type EngineType =
  | "profile"
  | "classifier"
  | "matcher"
  | "ranker"
  | "map"
  | "gap"
  | "drift"
  | "action";

export interface WorkspaceRow extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemberRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  status: WorkspaceMemberStatus;
  created_at: string;
  updated_at: string;
}

export interface PlanCatalogRow extends Record<string, unknown> {
  id: string;
  plan_code: string;
  version: number;
  status: "draft" | "active" | "retired";
  effective_from: string;
  effective_to: string | null;
  metadata: Json;
  created_at: string;
}

export interface PlanEntitlementRow extends Record<string, unknown> {
  id: string;
  plan_catalog_id: string;
  capability_key: string;
  value_type: "boolean" | "integer" | "decimal" | "enum";
  value_json: Json;
  metadata: Json;
  created_at: string;
}

export interface WorkspaceEntitlementRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  plan_catalog_id: string;
  capability_key: string;
  value_type: "boolean" | "integer" | "decimal" | "enum";
  value_json: Json;
  revision: number;
  effective_from: string;
  effective_to: string | null;
  metadata: Json;
  created_at: string;
}

export interface UsageLedgerRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  usage_type: UsageType;
  amount: number;
  occurred_at: string;
  idempotency_key: string;
  actor_user_id: string | null;
  trace_id: string | null;
  source_metadata: Json;
  created_at: string;
}

export interface AuditLogRow extends Record<string, unknown> {
  id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  actor_kind: "user" | "system" | "service";
  action: string;
  target_type: string;
  target_id: string | null;
  trace_id: string | null;
  metadata: Json;
  created_at: string;
}

export interface EngineVersionRow extends Record<string, unknown> {
  id: string;
  engine_type: EngineType;
  version: string;
  model: string | null;
  prompt_version: string | null;
  config_hash: string | null;
  metadata: Json;
  created_at: string;
}

type TableDefinition<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      workspaces: TableDefinition<WorkspaceRow>;
      workspace_members: TableDefinition<WorkspaceMemberRow>;
      plan_catalog: TableDefinition<PlanCatalogRow>;
      plan_entitlements: TableDefinition<PlanEntitlementRow>;
      workspace_entitlements: TableDefinition<WorkspaceEntitlementRow>;
      usage_ledger: TableDefinition<UsageLedgerRow>;
      audit_log: TableDefinition<AuditLogRow>;
      engine_versions: TableDefinition<EngineVersionRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_workspace: {
        Args: { p_name: string; p_slug: string; p_trace_id: string | null };
        Returns: WorkspaceRow;
      };
      initialize_workspace_entitlements: {
        Args: {
          p_workspace_id: string;
          p_plan_catalog_id: string | null;
          p_actor_user_id: string | null;
          p_trace_id: string | null;
        };
        Returns: undefined;
      };
      add_workspace_member: {
        Args: {
          p_workspace_id: string;
          p_user_id: string;
          p_role: WorkspaceMemberRole;
          p_trace_id: string | null;
        };
        Returns: WorkspaceMemberRow;
      };
      update_workspace_member: {
        Args: {
          p_workspace_id: string;
          p_member_id: string;
          p_role: WorkspaceMemberRole;
          p_trace_id: string | null;
        };
        Returns: WorkspaceMemberRow;
      };
      deactivate_workspace_member: {
        Args: { p_workspace_id: string; p_member_id: string; p_trace_id: string | null };
        Returns: WorkspaceMemberRow;
      };
      record_audit_event: {
        Args: {
          p_workspace_id: string | null;
          p_actor_user_id: string | null;
          p_actor_kind: "user" | "system" | "service";
          p_action: string;
          p_target_type: string;
          p_target_id: string | null;
          p_trace_id: string | null;
          p_metadata: Json;
        };
        Returns: AuditLogRow;
      };
      consume_usage: {
        Args: {
          p_workspace_id: string;
          p_usage_type: UsageType;
          p_amount: number;
          p_idempotency_key: string;
          p_source_metadata: Json;
          p_actor_user_id: string | null;
          p_trace_id: string | null;
        };
        Returns: UsageLedgerRow;
      };
      get_usage_totals: {
        Args: { p_workspace_id: string; p_period_start: string | null };
        Returns: Array<{ usage_type: UsageType; amount: number }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
