import { registerEngineVersion } from "./engine.repository";
import { registerEngineVersionInputSchema, type RegisterEngineVersionInput } from "./engine.schemas";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { AppError } from "@/server/lib/errors";

export async function registerEngine(input: unknown) {
  const parsed = registerEngineVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid engine version.", 422, {
      issues: parsed.error.issues,
    });
  }
  return registerEngineVersion(createSupabaseServiceClient(), parsed.data);
}

export type { RegisterEngineVersionInput };
