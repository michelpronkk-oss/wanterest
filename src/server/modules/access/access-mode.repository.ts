import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { accessModeSchema, publicAccessStateSchema, type AccessMode, type PublicAccessState } from "./access-mode.schemas";

type AccessClient = SupabaseClient;

function first<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}
function providerError(message: string, error: { message?: string } | null): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, error?.message ? { providerMessage: error.message } : undefined);
}

export type AccessModeRepository = {
  getPublicState(): Promise<PublicAccessState>;
  setMode(input: { mode: AccessMode; reason: string; actorUserId?: string | null }): Promise<{ mode: AccessMode; changed: boolean; version: number }>;
};

export function createSupabaseAccessModeRepository(client?: AccessClient): AccessModeRepository {
  const readClientPromise = client ? Promise.resolve(client) : createSupabaseServerClient();
  return {
    async getPublicState() {
      const readClient = await readClientPromise;
      const { data, error } = await readClient.rpc("get_product_access_state");
      if (error) throw providerError("Product access state could not be loaded.", error);
      const raw = first(data as Record<string, unknown> | Record<string, unknown>[] | null);
      const parsed = publicAccessStateSchema.safeParse({
        mode: raw?.mode,
        canRequestAccess: raw?.can_request_access,
        canSignUp: raw?.can_sign_up,
        inviteRequired: raw?.invite_required,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Product access state is invalid.");
      return parsed.data;
    },
    async setMode(input) {
      const serviceClient = createSupabaseServiceClient() as unknown as AccessClient;
      const { data, error } = await serviceClient.rpc("set_product_access_mode", {
        p_to_mode: input.mode,
        p_reason: input.reason,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw providerError("Product access mode could not be changed.", error);
      const raw = first(data as Record<string, unknown> | Record<string, unknown>[] | null);
      const mode = accessModeSchema.safeParse(raw?.mode);
      if (!mode.success || typeof raw?.changed !== "boolean" || typeof raw?.version !== "number") {
        throw new AppError("INTERNAL_ERROR", "Product access mode response is invalid.");
      }
      return { mode: mode.data, changed: raw.changed, version: raw.version };
    },
  };
}
