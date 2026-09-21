export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export type LlmProviderName = "openai" | "fixture";

export type LlmRuntimeConfig = {
  provider: LlmProviderName;
  model: string;
  apiKeyPresent: boolean;
};

export function resolveLlmRuntimeConfig(input: {
  openAiApiKey?: string | null;
  openAiModel?: string | null;
}): LlmRuntimeConfig {
  const apiKeyPresent = Boolean(input.openAiApiKey?.trim());
  const model = input.openAiModel?.trim() || DEFAULT_OPENAI_MODEL;
  return {
    provider: apiKeyPresent ? "openai" : "fixture",
    model: apiKeyPresent ? model : "deterministic",
    apiKeyPresent,
  };
}

export function engineRegistryVersion(version: string, config: LlmRuntimeConfig): string {
  return `${version}:${config.provider}:${config.model}`;
}
