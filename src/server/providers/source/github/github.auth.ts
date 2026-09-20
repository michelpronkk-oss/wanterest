import { z } from "zod";

const githubRuntimeSchema = z.object({
  GITHUB_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
});

export function getGitHubRuntimeConfig(env: Record<string, string | undefined> = process.env): { token?: string } {
  const parsed = githubRuntimeSchema.safeParse({ GITHUB_TOKEN: env.GITHUB_TOKEN });
  if (!parsed.success) throw new Error(`Invalid GitHub configuration: ${parsed.error.message}`);
  return { token: parsed.data.GITHUB_TOKEN };
}

