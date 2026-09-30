/** Opt-in server-side instrumentation; default off preserves existing acquisition behavior. */
export function sourceExecutionObservabilityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SOURCE_EXECUTION_OBSERVABILITY_ENABLED === "true";
}
