"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";

import type { OnboardingActionState } from "@/app/app/setup/actions";
import { completeProductUnderstandingAction, createOnboardingProductAction, createOnboardingWorkspaceAction } from "@/app/app/setup/actions";
import { getOnboardingSuccessPath } from "@/lib/onboarding-transition";
import { isValidOnboardingDescription, isValidOnboardingProductForm, isValidOnboardingWebsiteInput } from "./form-validation";
import { UpgradeTrigger } from "@/components/dashboard/upgrade-surface";

const initialState: OnboardingActionState = { status: "idle", error: null };
type FormAction = (formData: FormData) => void;

function useSubmitGuard(pending: boolean) {
  const submittedRef = useRef(false);
  useEffect(() => {
    if (!pending) submittedRef.current = false;
  }, [pending]);
  return (event: FormEvent<HTMLFormElement>) => {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
  };
}

function ActionError({ error }: { error: string | null }) {
  return error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null;
}

function useSuccessNavigation(state: OnboardingActionState) {
  const router = useRouter();
  const navigatedRef = useRef(false);
  const nextPath = getOnboardingSuccessPath(state);

  useEffect(() => {
    if (!nextPath || navigatedRef.current) return;
    navigatedRef.current = true;
    router.replace(nextPath);
  }, [nextPath, router]);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="onboarding-field-error" role="alert">{message}</p> : null;
}

function websiteFieldError(value: string, serverError?: string): string | undefined {
  if (!value.trim()) return serverError;
  return isValidOnboardingWebsiteInput(value)
    ? undefined
    : "Enter your product's public website or domain.";
}

function descriptionFieldError(value: string, serverError?: string): string | undefined {
  if (!value.trim()) return serverError;
  if (value.trim().length < 15) return "Use at least 15 characters.";
  if (value.trim().length > 240) return "Keep the description under 240 characters.";
  return undefined;
}

function WorkspaceSetupFields({ action, state, pending, initialWebsiteUrl }: { action: FormAction; state: OnboardingActionState; pending: boolean; initialWebsiteUrl: string | null }) {
  const [name, setName] = useState(state.values?.name ?? "");
  const canSubmit = name.trim().length > 0;
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={action} onSubmit={handleSubmit}>
      <input type="hidden" name="websiteUrl" value={initialWebsiteUrl ?? ""} />
      <div className="onboarding-field">
        <label className="onboarding-field-label" htmlFor="workspace-name">Workspace name</label>
        <input id="workspace-name" className="onboarding-input" name="name" defaultValue={name} onInput={(event) => setName(event.currentTarget.value)} required maxLength={120} placeholder="Acme research" autoComplete="organization" aria-invalid={Boolean(state.fieldErrors?.name)} aria-describedby={state.fieldErrors?.name ? "workspace-name-error" : undefined} />
        <FieldError id="workspace-name-error" message={state.fieldErrors?.name} />
      </div>
      <ActionError error={state.error} />
      <button className={`onboarding-cta${pending ? " is-pending" : ""}`} type="submit" disabled={pending || !canSubmit} aria-busy={pending}>{pending ? "Creating…" : "Continue →"}</button>
      <p className="onboarding-note">You&rsquo;ll become the owner and start on the internal Free plan.</p>
    </form>
  );
}

export function WorkspaceSetupForm({ initialWebsiteUrl = null }: { initialWebsiteUrl?: string | null }) {
  const [state, action, pending] = useActionState(createOnboardingWorkspaceAction, initialState);
  return <WorkspaceSetupFields key={state.values?.name ?? "initial"} action={action} state={state} pending={pending} initialWebsiteUrl={initialWebsiteUrl} />;
}

function ProductSetupFields({ workspaceId, action, state, pending, initialWebsiteUrl }: { workspaceId: string; action: FormAction; state: OnboardingActionState; pending: boolean; initialWebsiteUrl: string | null }) {
  const [websiteUrl, setWebsiteUrl] = useState(state.values?.websiteUrl ?? initialWebsiteUrl ?? "");
  const [description, setDescription] = useState(state.values?.description ?? "");
  const canSubmit = isValidOnboardingProductForm(websiteUrl, description);
  const handleSubmit = useSubmitGuard(pending);
  const websiteError = websiteFieldError(websiteUrl, state.fieldErrors?.websiteUrl);
  const descriptionError = descriptionFieldError(description, state.fieldErrors?.description);

  return (
    <form action={action} onSubmit={handleSubmit}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="onboarding-field">
        <label className="onboarding-field-label" htmlFor="product-website">Website</label>
        <input id="product-website" className="onboarding-input" name="websiteUrl" defaultValue={websiteUrl} onInput={(event) => setWebsiteUrl(event.currentTarget.value)} required maxLength={2_000} placeholder="yourdomain.com" inputMode="url" autoComplete="url" aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? "product-website-error" : undefined} />
        <FieldError id="product-website-error" message={websiteError} />
      </div>
      <div className="onboarding-field">
        <label className="onboarding-field-label" htmlFor="product-description">What do you do, in one line?</label>
        <textarea id="product-description" className="onboarding-textarea" name="description" defaultValue={description} onInput={(event) => setDescription(event.currentTarget.value)} required minLength={15} maxLength={240} placeholder="We help ops teams automate manual work between their inbox, CRM, and spreadsheets." aria-invalid={Boolean(descriptionError)} aria-describedby={descriptionError ? "product-description-error" : undefined} />
        <FieldError id="product-description-error" message={descriptionError} />
      </div>
      <ActionError error={state.error} />
      {state.upgrade ? <UpgradeTrigger workspaceId={workspaceId} currentPlan={state.upgrade.currentPlan ?? "free"} plan={state.upgrade.upgradeTarget} label={state.upgrade.upgradeTarget === "growth" ? "Upgrade to Growth" : "Upgrade to Pro"} /> : null}
      <button className={`onboarding-cta${pending ? " is-pending" : ""}`} type="submit" disabled={pending || !canSubmit} aria-busy={pending}>{pending ? "Preparing your product…" : "Find my demand signals →"}</button>
      <p className="onboarding-note">Takes about 30 seconds. No credit card required.</p>
    </form>
  );
}

export function ProductSetupForm({ workspaceId, initialWebsiteUrl = null }: { workspaceId: string; initialWebsiteUrl?: string | null }) {
  const [state, action, pending] = useActionState(createOnboardingProductAction, initialState);
  useSuccessNavigation(state);
  const formKey = `${state.values?.websiteUrl ?? initialWebsiteUrl ?? ""}:${state.values?.description ?? ""}`;
  return <ProductSetupFields key={formKey} workspaceId={workspaceId} action={action} state={state} pending={pending} initialWebsiteUrl={initialWebsiteUrl} />;
}

function ProductUnderstandingFields({ workspaceId, productId, websiteUrl, initialDescription, action, state, pending }: { workspaceId: string; productId: string; websiteUrl: string | null; initialDescription?: string | null; action: FormAction; state: OnboardingActionState; pending: boolean }) {
  const [description, setDescription] = useState(state.values?.description ?? initialDescription ?? "");
  const canSubmit = isValidOnboardingDescription(description);
  const handleSubmit = useSubmitGuard(pending);
  const descriptionError = descriptionFieldError(description, state.fieldErrors?.description);

  return (
    <form action={action} onSubmit={handleSubmit}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <div className="onboarding-field">
        <label className="onboarding-field-label" htmlFor="product-context">What do you do, in one line?</label>
        <textarea id="product-context" className="onboarding-textarea" name="description" defaultValue={description} onInput={(event) => setDescription(event.currentTarget.value)} required minLength={15} maxLength={240} placeholder="Describe the customer, problem, and outcome this product supports." aria-invalid={Boolean(descriptionError)} aria-describedby={descriptionError ? "product-context-error" : undefined} />
        <FieldError id="product-context-error" message={descriptionError} />
      </div>
      {websiteUrl ? <p className="onboarding-note" style={{ marginTop: -8, marginBottom: 16, textAlign: "left" }}>Website context: {websiteUrl}</p> : null}
      <ActionError error={state.error} />
      <button className={`onboarding-cta${pending ? " is-pending" : ""}`} type="submit" disabled={pending || !canSubmit} aria-busy={pending}>{pending ? "Preparing your product…" : "Continue →"}</button>
    </form>
  );
}

export function ProductUnderstandingForm({ workspaceId, productId, websiteUrl, initialDescription }: { workspaceId: string; productId: string; websiteUrl: string | null; initialDescription?: string | null }) {
  const [state, action, pending] = useActionState(completeProductUnderstandingAction, initialState);
  useSuccessNavigation(state);
  const formKey = state.values?.description ?? initialDescription ?? "initial";
  return <ProductUnderstandingFields key={formKey} workspaceId={workspaceId} productId={productId} websiteUrl={websiteUrl} initialDescription={initialDescription} action={action} state={state} pending={pending} />;
}
