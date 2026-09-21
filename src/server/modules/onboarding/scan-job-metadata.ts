import { jsonObjectSchema, omitUndefined, type JsonObject } from "../../db/database.helpers";
import type { ScanMode, ScanProgress } from "../operations/product-demand-scan.schemas";

export type ScanJobMetadataInput = {
  phase: string;
  scanMode?: ScanMode;
  result?: unknown;
  errorMessage?: string | null;
  completed?: boolean;
  progress?: Partial<ScanProgress>;
};

export function buildScanJobReference(input: ScanJobMetadataInput): JsonObject {
  const progress: ScanProgress = {
    stage: input.progress?.stage ?? (input.phase === "failed" ? "failed" : input.completed ? "completed" : "processing"),
    percent: input.progress?.percent ?? (input.completed ? 100 : 0),
    completedSources: input.progress?.completedSources ?? 0,
    totalSources: input.progress?.totalSources ?? 0,
    currentLabel: input.progress?.currentLabel ?? input.phase,
    warnings: input.progress?.warnings ?? [],
  };

  return jsonObjectSchema.parse(omitUndefined({
    workflow: "product-demand-scan",
    ...(input.scanMode ? { scanMode: input.scanMode } : {}),
    phase: input.phase,
    ...(input.result === undefined ? {} : { result: input.result }),
    errorMessage: input.errorMessage ?? null,
    progress,
  }));
}
