import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type { EngineVersionInsert, EngineVersionRow } from "@/server/db/database.helpers";
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

export async function ensureEngineVersion(
  client: SupabaseClient<Database>,
  input: EngineVersionInsert,
): Promise<EngineVersionRow> {
  const existing = await client
    .from("engine_versions")
    .select("*")
    .eq("engine_type", input.engine_type)
    .eq("version", input.version)
    .maybeSingle();
  if (existing.error) throw new AppError("INTERNAL_ERROR", "Engine version could not be loaded.");
  if (existing.data) return existing.data;

  const created = await client
    .from("engine_versions")
    .insert(input)
    .select("*")
    .single();
  if (!created.error && created.data) return created.data;
  if (created.error?.code === "23505") {
    const concurrent = await client
      .from("engine_versions")
      .select("*")
      .eq("engine_type", input.engine_type)
      .eq("version", input.version)
      .single();
    if (!concurrent.error && concurrent.data) return concurrent.data;
  }
  throw new AppError("INTERNAL_ERROR", "Engine version could not be registered.");
}
