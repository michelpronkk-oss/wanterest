import { startPathForWebsite } from "./site";

export type EntryScanState = "no_scan" | "running" | "failed" | "partial_failure" | "completed_no_signals" | "completed_with_signals" | null;

export type AuthenticatedEntryState = {
  authenticated: boolean;
  hasWorkspace: boolean;
  hasProduct: boolean;
  productUnderstandingReady: boolean;
  scanState: EntryScanState;
};

/**
 * Pure routing policy for the app funnel. Database access stays in /start;
 * this function keeps the resume rules explicit and easy to regression-test.
 */
export function getEntryDestination(state: AuthenticatedEntryState, websiteUrl?: string | null): string {
  if (!state.authenticated) return websiteUrl ? `/signup?website=${encodeURIComponent(websiteUrl)}` : "/signup";
  if (!state.hasWorkspace) return startPathForWebsite(websiteUrl).replace("/start", "/app/setup/workspace");
  if (!state.hasProduct) return startPathForWebsite(websiteUrl).replace("/start", "/app/setup/product");
  if (!state.productUnderstandingReady) return "/app/setup/product";
  if (state.scanState === "no_scan" || state.scanState === "running" || state.scanState === "failed") return "/app/setup/scan";
  return "/app";
}
