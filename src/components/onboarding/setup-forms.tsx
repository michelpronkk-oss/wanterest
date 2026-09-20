"use client";

import { useActionState } from "react";

import type { OnboardingActionState } from "@/app/app/setup/actions";
import { completeProductUnderstandingAction, createOnboardingProductAction, createOnboardingWorkspaceAction, runOnboardingScanAction } from "@/app/app/setup/actions";

const initialState: OnboardingActionState = { error: null };

function SubmitButton({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  return <button className="dashboard-button dashboard-button-primary" type="submit">{children}<span className="onboarding-pending-label">{pendingLabel}</span></button>;
}

function ActionError({ error }: { error: string | null }) {
  return error ? <p className="dashboard-inline-error onboarding-form-error" role="alert">{error}</p> : null;
}

export function WorkspaceSetupForm() {
  const [state, action, pending] = useActionState(createOnboardingWorkspaceAction, initialState);
  return (
    <form className="onboarding-form" action={action}>
      <label className="dashboard-field"><span>Workspace name</span><input name="name" required maxLength={120} placeholder="Acme research" autoComplete="organization" /></label>
      <p className="onboarding-help">You’ll become the owner and start on the internal Free plan.</p>
      <ActionError error={state.error} />
      <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
      {pending ? <span className="onboarding-status">Creating your workspace…</span> : null}
    </form>
  );
}

export function ProductSetupForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(createOnboardingProductAction, initialState);
  return (
    <form className="onboarding-form" action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="dashboard-field"><span>Product name</span><input name="name" required maxLength={200} placeholder="Acme analytics" autoComplete="off" /></label>
      <label className="dashboard-field"><span>Website URL</span><input name="websiteUrl" required maxLength={2_000} placeholder="acme.example" inputMode="url" autoComplete="url" /></label>
      <label className="dashboard-field"><span>What does it help people do? <em>(optional)</em></span><textarea name="description" maxLength={5_000} rows={5} placeholder="A short description helps the first demand profile." /></label>
      <p className="onboarding-help">The URL is stored as product context. Wanterest does not fetch arbitrary websites during setup.</p>
      <ActionError error={state.error} />
      <SubmitButton pendingLabel="Preparing…">Add product</SubmitButton>
      {pending ? <span className="onboarding-status">Creating the product profile…</span> : null}
    </form>
  );
}

export function ProductUnderstandingForm({ workspaceId, productId, websiteUrl }: { workspaceId: string; productId: string; websiteUrl: string | null }) {
  const [state, action, pending] = useActionState(completeProductUnderstandingAction, initialState);
  return (
    <form className="onboarding-form" action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <label className="dashboard-field"><span>Product context</span><textarea name="description" required maxLength={5_000} rows={6} placeholder="Describe the customer, problem, and outcome this product supports." /></label>
      {websiteUrl ? <p className="onboarding-help">Website context: {websiteUrl}</p> : null}
      <ActionError error={state.error} />
      <SubmitButton pendingLabel="Preparing…">Continue to first scan</SubmitButton>
      {pending ? <span className="onboarding-status">Building the demand profile…</span> : null}
    </form>
  );
}

export function FirstScanForm({ workspaceId, productId }: { workspaceId: string; productId: string }) {
  const [state, action, pending] = useActionState(runOnboardingScanAction, initialState);
  return (
    <form className="onboarding-form" action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <p className="onboarding-help">Wanterest will run a bounded scan through enabled, configured sources, then normalize, analyze, match, rank, and persist the results.</p>
      <ActionError error={state.error} />
      <SubmitButton pendingLabel="Scanning…">Run first scan</SubmitButton>
      {pending ? <span className="onboarding-status">Discovering conversations and building Signals…</span> : null}
    </form>
  );
}
