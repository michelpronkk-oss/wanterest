import { z } from "zod";

import type { Database, Json } from "./database.types";

type PublicTables = Database["public"]["Tables"];

export type WorkspaceRow = PublicTables["workspaces"]["Row"];
export type WorkspaceMemberRow = PublicTables["workspace_members"]["Row"];
export type WorkspaceEntitlementRow = PublicTables["workspace_entitlements"]["Row"];
export type UsageLedgerRow = PublicTables["usage_ledger"]["Row"];
export type AuditLogRow = PublicTables["audit_log"]["Row"];
export type EngineVersionRow = PublicTables["engine_versions"]["Row"];

export type WorkspaceMemberRole = WorkspaceMemberRow["role"];
export type UsageType = UsageLedgerRow["usage_type"];

export type { Json } from "./database.types";
export type JsonObject = { [key: string]: Json | undefined };

/** JSON values accepted by PostgreSQL jsonb columns. */
export const jsonValueSchema = z.json();
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
