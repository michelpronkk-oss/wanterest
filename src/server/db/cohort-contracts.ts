import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

/** Explicit migration-reviewed coverage, NOT generated from a database runtime.
 * Sources: 13A.2 foundation/RPC repair, 13A.2B wrapper, 13A.4 profiles/monogram
 * repair and pending public URL repair. SQL text outputs stay string; Zod narrows.
 * Preserve the existing generated snapshot (including its encoding) unchanged.
 */
export type PublicCohortRpcRow = {
  public_slug: string; display_name: string; logo_url: string | null;
  avatar_url: string | null; monogram: string | null; headline: string | null;
  website_url: string | null; cohort: string; cohort_number: number;
  cohort_limit: number; assigned_at: string;
};
export type PrivateCohortProfileRpcRow = PublicCohortRpcRow & {
  profile_id: string; workspace_id: string; wall_visible: boolean; pass_visible: boolean;
};
export type CohortAssignmentRpcRow = {
  assignment_status: string; membership_id: string | null; workspace_id: string;
  cohort: string | null; cohort_number: number | null; assigned_at: string | null;
  source_waitlist_application_id: string | null; admission_principal_user_id: string | null;
  assignment_reason: string; assignment_version: string;
};
type AssignmentArgs = {
  p_workspace_id: string; p_source_waitlist_application_id?: string | null;
  p_admission_principal_user_id?: string | null; p_assignment_reason?: string;
  p_assignment_version?: string;
};
export type CohortDatabaseFunctions = {
  assign_workspace_cohort_membership: { Args: AssignmentArgs; Returns: CohortAssignmentRpcRow[] };
  assign_workspace_cohort_membership_with_benefit: { Args: AssignmentArgs; Returns: Array<CohortAssignmentRpcRow & { benefit_policy_key: string | null; benefit_status: string | null }> };
  get_workspace_cohort_identity: {
    Args: { p_workspace_id: string };
    Returns: Array<{ workspace_id: string; cohort: string; cohort_number: number | null; assigned_at: string | null; cohort_limit: number | null; display_identity: string | null; workspace_status: string }>;
  };
  get_public_cohort_wall: { Args: { p_cohort: string }; Returns: PublicCohortRpcRow[] };
  get_public_cohort_profile: { Args: { p_public_slug: string }; Returns: PublicCohortRpcRow[] };
  get_workspace_public_cohort_profile: { Args: { p_workspace_id: string }; Returns: PrivateCohortProfileRpcRow[] };
  upsert_workspace_public_cohort_profile: {
    Args: {
      p_workspace_id: string; p_public_slug: string; p_display_name?: string | null;
      p_logo_url?: string | null; p_avatar_url?: string | null; p_monogram?: string | null;
      p_headline?: string | null; p_website_url?: string | null;
      p_wall_visible?: boolean | null; p_pass_visible?: boolean | null; p_trace_id?: string | null;
    };
    Returns: PrivateCohortProfileRpcRow[];
  };
  initialize_workspace_public_cohort_profile: {
    Args: { p_workspace_id: string; p_public_slug: string; p_trace_id?: string | null };
    Returns: PrivateCohortProfileRpcRow[];
  };
  derive_public_cohort_monogram: { Args: { p_display_name: string }; Returns: string };
  decode_public_cohort_url_component: { Args: { p_value: string }; Returns: string | null };
  is_public_cohort_url: { Args: { p_url: string | null }; Returns: boolean };
};
type MembershipRow = {
  id: string; workspace_id: string; cohort: string; cohort_number: number; assigned_at: string;
  source_waitlist_application_id: string | null; admission_principal_user_id: string | null;
  assignment_reason: string; assignment_version: string; created_at: string;
};
type ProfileRow = {
  id: string; workspace_id: string; cohort_membership_id: string;
  public_slug: string; display_name: string; logo_url: string | null; avatar_url: string | null;
  monogram: string | null; headline: string | null; website_url: string | null;
  wall_visible: boolean; pass_visible: boolean; created_at: string; updated_at: string;
};
type EventRow = {
  id: string; workspace_id: string; membership_id: string; event_type: string;
  actor_kind: string; actor_user_id: string | null; metadata: Json; created_at: string;
};
type Relationship<Columns extends string[], Relation extends string, Referenced extends string[]> = {
  // Catalog-generated constraint names/one-to-one metadata await isolated generation.
  foreignKeyName: string; columns: Columns; isOneToOne: boolean;
  referencedRelation: Relation; referencedColumns: Referenced;
};
type Table<Row, Required extends keyof Row, Relationships extends unknown[]> = {
  Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>; Relationships: Relationships;
};
export type CohortDatabaseTables = {
  workspace_cohort_memberships: Table<MembershipRow, "workspace_id" | "cohort" | "cohort_number", [
    Relationship<["workspace_id"], "workspaces", ["id"]>,
    Relationship<["source_waitlist_application_id"], "waitlist_applications", ["id"]>,
    Relationship<["admission_principal_user_id"], "users", ["id"]>
  ]>;
  workspace_public_cohort_profiles: Table<ProfileRow, "workspace_id" | "cohort_membership_id" | "public_slug" | "display_name", [Relationship<["workspace_id", "cohort_membership_id"], "workspace_cohort_memberships", ["workspace_id", "id"]>]>;
  workspace_cohort_allocation_state: Table<{ cohort: string; next_number: number; capacity: number; assigned_count: number }, "cohort" | "next_number" | "capacity", []>;
  workspace_cohort_membership_events: Table<EventRow, "workspace_id" | "membership_id" | "event_type" | "actor_kind", [
    Relationship<["workspace_id", "membership_id"], "workspace_cohort_memberships", ["workspace_id", "id"]>,
    Relationship<["actor_user_id"], "users", ["id"]>
  ]>;
};
export type CohortDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & CohortDatabaseTables;
    Functions: Database["public"]["Functions"] & CohortDatabaseFunctions;
  };
};

/** One reviewed structural boundary; no client recreation, role change or network call. */
export function withCohortRpcContracts(client: SupabaseClient<Database>): Pick<SupabaseClient<CohortDatabase>, "rpc"> {
  return client as unknown as Pick<SupabaseClient<CohortDatabase>, "rpc">;
}
