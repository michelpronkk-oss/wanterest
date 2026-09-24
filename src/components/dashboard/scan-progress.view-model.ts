import type { ScanProgress, ScanResultSummary } from "@/server/modules/operations/product-demand-scan.schemas";
import { sourceHealthCoverageCopy } from "@/shared/source-health-v1";

export type ScanStep = { key: string; label: string; done: boolean; failed: boolean };

const STAGE_ORDER = [
  "preparing_product",
  "planning",
  "discovering",
  "processing",
  "qualifying",
  "building_intelligence",
  "generating_actions",
] as const;

const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], string> = {
  preparing_product: "Understanding your product",
  planning: "Choosing the best sources",
  discovering: "Finding conversations",
  processing: "Qualifying real demand",
  qualifying: "Qualifying real demand",
  building_intelligence: "Building your demand map",
  generating_actions: "Preparing actions",
};

/** Maps the backend scan stage enum to calm, user-facing step labels. Shared by the onboarding scan page and the Rescan modal. */
export function scanSteps(progress: ScanProgress | null | undefined): ScanStep[] {
  const stage = progress?.stage ?? "queued";
  const failed = stage === "failed";
  const currentIndex = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const completedIndex = stage === "completed" || stage === "partial_failure" ? STAGE_ORDER.length : currentIndex;

  const steps: ScanStep[] = [
    { key: "preparing_product", label: STAGE_LABELS.preparing_product, done: false, failed: false },
    { key: "planning", label: STAGE_LABELS.planning, done: false, failed: false },
    { key: "discovering", label: STAGE_LABELS.discovering, done: false, failed: false },
    { key: "processing", label: "Qualifying real demand", done: false, failed: false },
    { key: "building_intelligence", label: STAGE_LABELS.building_intelligence, done: false, failed: false },
    { key: "generating_actions", label: STAGE_LABELS.generating_actions, done: false, failed: false },
  ];
  const stepStageKeys = ["preparing_product", "planning", "discovering", "processing", "building_intelligence", "generating_actions"];

  return steps.map((step, index) => {
    const stageIndex = STAGE_ORDER.indexOf(stepStageKeys[index] as (typeof STAGE_ORDER)[number]);
    const effectiveIndex = stepStageKeys[index] === "processing" ? STAGE_ORDER.indexOf("qualifying") : stageIndex;
    const done = completedIndex > effectiveIndex || stage === "completed";
    return { ...step, done, failed: failed && !done };
  });
}

export function scanStatusLabel(stage: string | undefined, manual = false): string {
  switch (stage) {
    case "completed":
      return "Your first scan is ready";
    case "partial_failure":
      return "Scan completed with limited source coverage";
    case "failed":
      return "Your first scan couldn’t finish";
    case "queued":
    case "planning":
      return manual ? "Refreshing market intelligence…" : "Preparing your first scan…";
    case "discovering":
      return manual ? "Refreshing market intelligence…" : "Finding relevant conversations…";
    case "processing":
    case "qualifying":
      return manual ? "Refreshing market intelligence…" : "Qualifying real demand…";
    case "building_intelligence":
      return manual ? "Refreshing market intelligence…" : "Building your demand map…";
    case "generating_actions":
      return manual ? "Refreshing market intelligence…" : "Preparing recommended actions…";
    default:
      return manual ? "Refreshing market intelligence…" : "Preparing your first scan…";
  }
}

export function scanResultDestination(result: ScanResultSummary | null): "/app/signals" | "/app/insights/map" | null {
  if (!result) return null;
  if (result.signals > 0) return "/app/signals";
  if ((result.qualification?.qualifiedCount ?? 0) > 0 && (result.mapUpdated > 0 || result.gapUpdated > 0 || result.driftUpdated > 0)) return "/app/insights/map";
  return null;
}

export function scanCoverageCopy(result: ScanResultSummary | null, partial: boolean): string {
  const canonicalCopy = result?.sourceHealthV1?.coverage;
  if (canonicalCopy) {
    return sourceHealthCoverageCopy[canonicalCopy.label];
  }
  const sourceCount = result?.sources.length ?? 0;
  return `${sourceCount} source${sourceCount === 1 ? "" : "s"} scanned · ${partial ? "Limited coverage" : "Coverage recorded"}`;
}
