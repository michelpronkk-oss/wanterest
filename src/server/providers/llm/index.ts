import "server-only";

import { getServerEnv } from "@/server/lib/env";

import { OpenAIChatStructuredLlmProvider } from "./openai";
import { resolveLlmRuntimeConfig, type LlmRuntimeConfig } from "./config";
import type { StructuredLlmProvider } from "./contracts";

export type { StructuredGenerationRequest, StructuredGenerationResult, StructuredLlmProvider } from "./contracts";
export { DEFAULT_OPENAI_MODEL, engineRegistryVersion, resolveLlmRuntimeConfig, type LlmProviderName, type LlmRuntimeConfig } from "./config";
export { OpenAIChatStructuredLlmProvider, OpenAIProviderError } from "./openai";
export { toStructuredJsonSchema } from "./json-schema";

export function getLlmRuntimeConfig(): LlmRuntimeConfig {
  const env = getServerEnv();
  return resolveLlmRuntimeConfig({ openAiApiKey: env.OPENAI_API_KEY, openAiModel: env.OPENAI_MODEL });
}

export function getStructuredLlmProvider(): { config: LlmRuntimeConfig; provider: StructuredLlmProvider | null } {
  const env = getServerEnv();
  const config = resolveLlmRuntimeConfig({ openAiApiKey: env.OPENAI_API_KEY, openAiModel: env.OPENAI_MODEL });
  return {
    config,
    provider: config.provider === "openai" && env.OPENAI_API_KEY
      ? new OpenAIChatStructuredLlmProvider({ apiKey: env.OPENAI_API_KEY, model: config.model })
      : null,
  };
}
