import type { ReactNode } from "react";

import { LogoMark } from "@/components/dashboard/nav-icons";

const STEP_COUNT = 3;

export function OnboardingShell({ step, children }: { step: 1 | 2 | 3; children: ReactNode }) {
  return (
    <div className="onboarding-shell">
      <div className="onboarding-shell-logo">
        <LogoMark size={24} />
        <span className="onboarding-shell-logo-text">wanterest</span>
      </div>
      <div className="onboarding-progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={STEP_COUNT} aria-label={`Setup step ${step} of ${STEP_COUNT}`}>
        <span className="onboarding-progress-caption">Step {step} of {STEP_COUNT}</span>
        <div className="onboarding-dots" aria-hidden="true">
        {Array.from({ length: STEP_COUNT }, (_, index) => index + 1).map((dot) => (
          <span key={dot} className={`onboarding-dot${dot === step ? " is-active" : dot < step ? " is-done" : ""}`} />
        ))}
        </div>
      </div>
      {children}
    </div>
  );
}
