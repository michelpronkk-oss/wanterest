export const ONBOARDING_SCAN_PATH = "/app/setup/scan" as const;

export function onboardingSuccessState(productId: string) {
  return {
    status: "success" as const,
    error: null,
    productId,
    nextPath: ONBOARDING_SCAN_PATH,
  };
}

export function getOnboardingSuccessPath(state: { status: string; nextPath?: string }) {
  return state.status === "success" && state.nextPath === ONBOARDING_SCAN_PATH
    ? ONBOARDING_SCAN_PATH
    : null;
}
