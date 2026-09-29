/**
 * Pure, framework-free logic behind the Request Access form, kept separate so the contract with
 * POST /api/waitlist is testable without a browser.
 *
 * Contract (server: waitlistApplicationInputSchema, database: waitlist_applications):
 * - Required: firstName (1–80), companyName (1–160), email (valid, ≤320) and useCase (1–1200;
 *   the column is NOT NULL with a length check). useCase is therefore a primary field, never
 *   part of the optional context — hiding it there would mislabel a required field.
 * - Optional: companyWebsite (public http(s) URL), roleTitle, marketingConsent (independent,
 *   defaults to false), attribution fields, referral code.
 * The client only mirrors "is it present / shaped like an email"; the server stays authoritative.
 */

export const MAX_USE_CASE = 1200;

export type RequiredField = "firstName" | "companyName" | "email" | "useCase";

export type WaitlistFormValues = {
  firstName: string;
  companyName: string;
  email: string;
  useCase: string;
  companyWebsite: string;
  roleTitle: string;
  marketingConsent: boolean;
  honeypot: string;
};

export const REQUIRED_FIELD_ORDER: RequiredField[] = ["firstName", "companyName", "email", "useCase"];

const REQUIRED_MESSAGES: Record<RequiredField, string> = {
  firstName: "Add your first name.",
  companyName: "Add your company.",
  email: "Enter a valid work email.",
  useCase: "Add a line here so we know what to review.",
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Missing or malformed required fields, in on-screen order, with the message to show for each. */
export function requiredFieldErrors(values: Pick<WaitlistFormValues, RequiredField>): Partial<Record<RequiredField, string>> {
  const errors: Partial<Record<RequiredField, string>> = {};
  for (const field of REQUIRED_FIELD_ORDER) {
    const value = values[field].trim();
    if (!value || (field === "email" && !EMAIL_SHAPE.test(value))) errors[field] = REQUIRED_MESSAGES[field];
  }
  return errors;
}

/** Matches the site-wide convention (see marketing/links.ts): a bare domain is treated as https. */
export function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** "https://www.linear.app/x" → "linear.app", for the collapsed context summary. */
export function websiteLabel(url: string): string {
  try {
    return new URL(normalizeWebsiteInput(url)).hostname.replace(/^www\./, "");
  } catch {
    return url.trim();
  }
}

/** The exact POST /api/waitlist body — unchanged field for field from the previous form. */
export function buildWaitlistPayload(values: WaitlistFormValues, search: string, referrer: string) {
  const params = new URLSearchParams(search);
  const utm = (key: string) => (params.get(key) ?? "").slice(0, 160);
  return {
    firstName: values.firstName,
    email: values.email,
    companyName: values.companyName,
    companyWebsite: normalizeWebsiteInput(values.companyWebsite),
    roleTitle: values.roleTitle,
    useCase: values.useCase.trim(),
    marketingConsent: values.marketingConsent,
    honeypot: values.honeypot,
    source: utm("source") || "waitlist",
    utmSource: utm("utm_source"),
    utmMedium: utm("utm_medium"),
    utmCampaign: utm("utm_campaign"),
    utmContent: utm("utm_content"),
    utmTerm: utm("utm_term"),
    referrerCategory: referrer ? "external" : "direct",
    referralCode: utm("ref"),
  };
}

export type WaitlistPayload = ReturnType<typeof buildWaitlistPayload>;

export type SubmitResult = { ok: true } | { ok: false; message: string; retryAfterSeconds?: number };

/** Posts the request; maps every failure (server, rate limit, network) to a displayable message. */
export async function submitWaitlistRequest(payload: WaitlistPayload, fetchImpl: typeof fetch = fetch): Promise<SubmitResult> {
  try {
    const response = await fetchImpl("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => null) as { error?: { message?: string; details?: { retryAfterSeconds?: number } } } | null;
    return { ok: false, message: body?.error?.message ?? "We couldn't save that. Please try again.", retryAfterSeconds: body?.error?.details?.retryAfterSeconds };
  } catch {
    return { ok: false, message: "Wanterest isn't reachable right now. Please try again in a moment." };
  }
}
