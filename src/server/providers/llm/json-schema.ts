import { z } from "zod";

/** Converts a Zod contract to the JSON Schema shape accepted by OpenAI structured output. */
export function toStructuredJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: "draft-07" }) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(generated).filter(([key]) => key !== "$schema"));
}
