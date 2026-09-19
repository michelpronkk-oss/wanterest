import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/server/db/database.types";
import { jsonObjectSchema, type AuditLogRow } from "../../db/database.helpers";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";

const auditInputSchema = z.object({
  workspaceId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorKind: z.enum(["user", "system", "service"]),
  action: z.string().trim().min(1).max(120),
  targetType: z.string().trim().min(1).max(120),
  targetId: z.string().uuid().nullable().optional(),
  traceId: z.string().trim().max(120).nullable().optional(),
  metadata: jsonObjectSchema.default({}),
});

export type AuditInput = z.infer<typeof auditInputSchema>;

export async function recordAuditEvent(
  input: unknown,
  client?: SupabaseClient<Database>,
): Promise<AuditLogRow> {
  const parsed = auditInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid audit event.");

  const supabase = client ?? createSupabaseServiceClient();
  const args: Database["public"]["Functions"]["record_audit_event"]["Args"] = {
    p_workspace_id: parsed.data.workspaceId,
    p_actor_user_id: parsed.data.actorUserId,
    p_actor_kind: parsed.data.actorKind,
    p_action: parsed.data.action,
    p_target_type: parsed.data.targetType,
    p_metadata: parsed.data.metadata,
  };
  if (parsed.data.targetId !== undefined && parsed.data.targetId !== null) {
    args.p_target_id = parsed.data.targetId;
  }
  if (parsed.data.traceId !== undefined && parsed.data.traceId !== null) {
    args.p_trace_id = parsed.data.traceId;
  }

  const { data, error } = await supabase.rpc("record_audit_event", args);
  if (error || !data) throw new AppError("INTERNAL_ERROR", "Audit event could not be recorded.");
  return data;
}
