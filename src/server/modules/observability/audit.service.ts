import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AuditLogRow, Database, Json } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";

const auditInputSchema = z.object({
  workspaceId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable().optional(),
  actorKind: z.enum(["user", "system", "service"]),
  action: z.string().trim().min(1).max(120),
  targetType: z.string().trim().min(1).max(120),
  targetId: z.string().uuid().nullable().optional(),
  traceId: z.string().trim().max(120).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AuditInput = z.infer<typeof auditInputSchema>;

export async function recordAuditEvent(
  input: unknown,
  client?: SupabaseClient<Database>,
): Promise<AuditLogRow> {
  const parsed = auditInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid audit event.");

  const supabase = client ?? createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("record_audit_event", {
    p_workspace_id: parsed.data.workspaceId,
    p_actor_user_id: parsed.data.actorUserId ?? null,
    p_actor_kind: parsed.data.actorKind,
    p_action: parsed.data.action,
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId ?? null,
    p_trace_id: parsed.data.traceId ?? null,
    p_metadata: parsed.data.metadata as Json,
  });
  if (error || !data) throw new AppError("INTERNAL_ERROR", "Audit event could not be recorded.");
  return data;
}
