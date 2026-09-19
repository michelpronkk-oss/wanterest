import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type { EngineVersionRow } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";
import type { RegisterEngineVersionInput } from "./engine.schemas";

export async function registerEngineVersion(
  client: SupabaseClient<Database>,
  input: RegisterEngineVersionInput,
): Promise<EngineVersionRow> {
  const { data, error } = await client
    .from("engine_versions")
    .insert({
      engine_type: input.engineType,
      version: input.version,
      model: input.model ?? null,
      prompt_version: input.promptVersion ?? null,
      config_hash: input.configHash ?? null,
      metadata: input.metadata,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "Engine version already exists.");
    throw new AppError("INTERNAL_ERROR", "Engine version could not be registered.");
  }
  return data;
}
