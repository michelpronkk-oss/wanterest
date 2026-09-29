"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import styles from "./membership-settings.module.css";

/** Editable public-profile fields exactly as the existing PATCH contract accepts them. */
export type PublicProfileFormValues = {
  publicSlug: string;
  displayName: string;
  headline: string | null;
  logoUrl: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  monogram: string | null;
  wallVisible: boolean;
  passVisible: boolean;
};

type FieldKey = Exclude<keyof PublicProfileFormValues, "wallVisible" | "passVisible">;
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string; fields: Partial<Record<keyof PublicProfileFormValues, string>> };

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * The existing PATCH is replacement-style: omitted optional fields become null
 * and omitted visibility flags become false. Every save therefore sends the
 * complete intended profile, including BOTH independent visibility flags, so a
 * change to one flag can never silently reset the other.
 */
export function completeProfilePayload(values: PublicProfileFormValues): PublicProfileFormValues {
  return {
    publicSlug: values.publicSlug.trim(),
    displayName: values.displayName.trim(),
    headline: emptyToNull(values.headline),
    logoUrl: emptyToNull(values.logoUrl),
    avatarUrl: emptyToNull(values.avatarUrl),
    websiteUrl: emptyToNull(values.websiteUrl),
    monogram: emptyToNull(values.monogram)?.toUpperCase() ?? null,
    wallVisible: values.wallVisible,
    passVisible: values.passVisible,
  };
}

function Switch({ id, checked, onChange, disabled, labelledBy, describedBy }: { id: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; labelledBy: string; describedBy: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy} className={styles.switch} data-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className={styles.switchThumb} aria-hidden="true" />
    </button>
  );
}

export function PublicProfileEditor({ workspaceId, initial, publicOrigin }: { workspaceId: string; initial: PublicProfileFormValues; publicOrigin: string }) {
  const router = useRouter();
  const formId = useId();
  const [values, setValues] = useState<PublicProfileFormValues>(initial);
  const [saved, setSaved] = useState<PublicProfileFormValues>(initial);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const dirty = JSON.stringify(completeProfilePayload(values)) !== JSON.stringify(completeProfilePayload(saved));
  const saving = state.kind === "saving";

  function update<K extends keyof PublicProfileFormValues>(key: K, value: PublicProfileFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (state.kind === "saved") setState({ kind: "idle" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = completeProfilePayload(values);
    if (!payload.displayName) {
      setState({ kind: "error", message: "Add a public display name before saving.", fields: { displayName: "Required." } });
      return;
    }
    setState({ kind: "saving" });
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/public-profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as { profile?: PublicProfileFormValues; error?: { code?: string; message?: string } } | null;
      if (!response.ok || !body?.profile) {
        // The API returns a safe message without per-field issues.
        const message = response.status === 422
          ? "Check the public address format and that every link is a public, credential-free HTTPS URL."
          : response.status === 401 || response.status === 403
            ? "Only workspace owners and admins can change the public profile."
            : body?.error?.message ?? "The public profile could not be saved.";
        setState({ kind: "error", message, fields: {} });
        return;
      }
      const next = completeProfilePayload({ ...payload, ...pick(body.profile) });
      setValues(next);
      setSaved(next);
      setState({ kind: "saved" });
      // Re-render the server-selected identity preview from the persisted profile.
      router.refresh();
    } catch {
      setState({ kind: "error", message: "The public profile could not be saved. Check your connection and try again.", fields: {} });
    }
  }

  const fieldError = (key: keyof PublicProfileFormValues) => state.kind === "error" ? state.fields[key] : undefined;
  const text = (key: FieldKey, label: string, hint: string, options: { type?: string; maxLength?: number; placeholder?: string; prefix?: string } = {}) => {
    const id = `${formId}-${key}`;
    const error = fieldError(key);
    return (
      <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <div className={styles.inputRow}>
          {options.prefix ? <span className={styles.prefix}>{options.prefix}</span> : null}
          <input id={id} name={key} type={options.type ?? "text"} value={values[key] ?? ""} maxLength={options.maxLength} placeholder={options.placeholder} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} disabled={saving} onChange={(event) => update(key, event.target.value)} />
        </div>
        <span id={`${id}-hint`} className={styles.hint}>{hint}</span>
        {error ? <span id={`${id}-error`} className={styles.error}>{error}</span> : null}
      </div>
    );
  };

  const wallLabel = `${formId}-wall-label`;
  const passLabel = `${formId}-pass-label`;

  return (
    <form className={styles.editor} onSubmit={(event) => void submit(event)} noValidate aria-describedby={`${formId}-contract`}>
      <p id={`${formId}-contract`} className={styles.srOnly}>Saving sends your complete public profile, including both visibility choices.</p>
      <div className={styles.consent} role="group" aria-label="Publication consent">
        <div className={styles.consentRow}>
          <div>
            <div id={wallLabel} className={styles.consentTitle}>Show on Members Wall</div>
            <div id={`${wallLabel}-hint`} className={styles.consentHint}>Name, identity image and serial appear on /members.</div>
          </div>
          <Switch id={`${formId}-wall`} checked={values.wallVisible} onChange={(value) => update("wallVisible", value)} disabled={saving} labelledBy={wallLabel} describedBy={`${wallLabel}-hint`} />
        </div>
        <div className={styles.consentRow}>
          <div>
            <div id={passLabel} className={styles.consentTitle}>Public Founder Pass</div>
            <div id={`${passLabel}-hint`} className={styles.consentHint}>Creates /members/{values.publicSlug || "your-address"}. Independent of the wall.</div>
          </div>
          <Switch id={`${formId}-pass`} checked={values.passVisible} onChange={(value) => update("passVisible", value)} disabled={saving} labelledBy={passLabel} describedBy={`${passLabel}-hint`} />
        </div>
      </div>

      <div className={styles.fields}>
        {text("displayName", "Public display name", "Shown on the wall and pass.", { maxLength: 160 })}
        {text("publicSlug", "Public address", "Lowercase letters, numbers and hyphens.", { maxLength: 80, prefix: "/members/" })}
        {text("headline", "Headline", "Optional. One line about the workspace.", { maxLength: 240 })}
        {text("monogram", "Monogram fallback", "Optional. Up to 3 letters or numbers, used when no image is shown.", { maxLength: 3 })}
        {text("logoUrl", "Company logo URL", "Optional. A public, credential-free HTTPS image link. Shown first.", { type: "url", placeholder: "https://" })}
        {text("avatarUrl", "Profile photo URL", "Optional. Used when no company logo is set or it fails to load.", { type: "url", placeholder: "https://" })}
        {text("websiteUrl", "Website", "Optional. Linked from the public pass.", { type: "url", placeholder: "https://" })}
      </div>
      <p className={styles.note}>Image uploads aren&rsquo;t available yet. Use links to images you already publish; Wanterest never fetches them on the server, and visitors&rsquo; browsers load them directly.</p>

      <div className={styles.footer}>
        <button type="submit" className="dashboard-button dashboard-button-primary" disabled={saving || !dirty}>{saving ? "Saving…" : "Save public profile"}</button>
        {dirty && !saving ? <button type="button" className="dashboard-button dashboard-button-secondary" onClick={() => { setValues(saved); setState({ kind: "idle" }); }}>Discard changes</button> : null}
        <span className={styles.status} role="status" aria-live="polite">
          {state.kind === "saved" ? "Saved." : state.kind === "saving" ? "Saving your public profile…" : ""}
        </span>
      </div>
      {state.kind === "error" ? <p className={styles.formError} role="alert">{state.message}</p> : null}
      {saved.passVisible ? <p className={styles.note}>Public pass address: <span className={styles.mono}>{publicOrigin}/members/{saved.publicSlug}</span>. It is published only while the pass is public and the workspace is active.</p> : null}
    </form>
  );
}

function pick(profile: Partial<PublicProfileFormValues>): Partial<PublicProfileFormValues> {
  const keys: Array<keyof PublicProfileFormValues> = ["publicSlug", "displayName", "headline", "logoUrl", "avatarUrl", "websiteUrl", "monogram", "wallVisible", "passVisible"];
  return Object.fromEntries(keys.filter((key) => key in profile).map((key) => [key, profile[key]])) as Partial<PublicProfileFormValues>;
}
