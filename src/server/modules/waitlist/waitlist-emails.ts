import "server-only";

import type { EmailMessage } from "@/server/providers/email";

export type TransactionalEmailContent = Omit<EmailMessage, "to">;

const BRAND = "Wanterest";
const PAGE_BACKGROUND = "#F7F6F1";
const INK = "#111110";
const BODY = "#4A4A43";
const MUTED = "#8C8C82";
const FAINT = "#A3A399";
const BORDER = "#E7E6DF";
const DIVIDER = "#EEEDE7";
const LIME = "#D7FF3D";

type EmailShellInput = {
  title: string;
  preview: string;
  eyebrow: string;
  heading: string;
  greeting: string;
  body: string;
  action?: { label: string; href: string };
  detailTitle?: string;
  detailBody?: string;
  security?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function plainText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function safeAbsoluteUrl(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
    throw new Error("Transactional email links must use a safe absolute HTTP(S) URL.");
  }
  return parsed.toString();
}

function preheader(value: string): string {
  return `${escapeHtml(value)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;`;
}

function actionButton(action: { label: string; href: string }): string {
  const href = escapeHtml(safeAbsoluteUrl(action.href));
  const label = escapeHtml(action.label);
  return `
    <table role="presentation" class="wx-btn-table" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:32px 0 0 0;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:270px;" arcsize="20%" stroke="f" fillcolor="${INK}">
          <w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${label} &rarr;</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!--><a href="${href}" class="wx-btn-a" target="_blank" style="display:inline-block;background-color:${INK};color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;text-decoration:none;padding:16px 28px;border-radius:10px;mso-hide:all;">${label} &rarr;</a><!--<![endif]-->
      </td></tr>
    </table>`;
}

function rawLinkFallback(action: { label: string; href: string }): string {
  const href = escapeHtml(safeAbsoluteUrl(action.href));
  return `<tr><td style="padding:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:20px;color:${FAINT};word-break:break-all;">Button not working? ${escapeHtml(action.label)} using this link:<br><a href="${href}" target="_blank" style="color:${BODY};text-decoration:underline;">${href}</a></td></tr>`;
}

/**
 * Shared email-safe layout based on the approved Opus reference: a single 600px
 * card, text wordmark and restrained lime dot. All user supplied text is escaped
 * by the caller-facing renderers below; URLs are direct, untracked fallback links.
 */
function renderHtml(input: EmailShellInput): string {
  const action = input.action ? { ...input.action, href: safeAbsoluteUrl(input.action.href) } : null;
  const details = input.detailTitle && input.detailBody ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:40px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${DIVIDER}" style="height:1px;background-color:${DIVIDER};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td style="padding:22px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${INK};font-weight:bold;">${escapeHtml(input.detailTitle)}</td></tr>
      <tr><td style="padding:6px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">${escapeHtml(input.detailBody)}</td></tr>
    </table>` : "";
  const security = input.security ? `<tr><td style="padding:26px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:20px;color:${FAINT};">${escapeHtml(input.security)}</td></tr>` : "";

  return `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(input.title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,a,span,p,h1{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
  <style>
    body{margin:0 !important;padding:0 !important;width:100% !important;background-color:${PAGE_BACKGROUND};}
    table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
    img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    a{color:${INK};}
    @media only screen and (max-width:620px){.wx-container{width:100% !important;}.wx-card-pad{padding:36px 24px 32px 24px !important;}.wx-outer-pad{padding:24px 12px 32px 12px !important;}.wx-h1{font-size:30px !important;line-height:36px !important;}.wx-btn-table{width:100% !important;}.wx-btn-a{display:block !important;text-align:center !important;}.wx-foot-pad{padding:24px 12px 0 12px !important;}}
  </style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};" bgcolor="${PAGE_BACKGROUND}">
  <div lang="en" dir="ltr" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${PAGE_BACKGROUND};">${preheader(input.preview)}</div>
  <table role="presentation" lang="en" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BACKGROUND}" style="background-color:${PAGE_BACKGROUND};"><tr><td align="center" class="wx-outer-pad" style="padding:48px 16px 48px 16px;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
    <table role="presentation" class="wx-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;"><tr><td bgcolor="#FFFFFF" class="wx-card-pad" style="background-color:#FFFFFF;border:1px solid ${BORDER};border-radius:16px;padding:48px 52px 44px 52px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:24px;font-weight:bold;letter-spacing:-0.2px;color:${INK};">wanterest</td><td width="7" style="width:7px;font-size:0;line-height:0;">&nbsp;</td><td valign="middle" style="padding:2px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="6" height="6" bgcolor="${LIME}" style="width:6px;height:6px;background-color:${LIME};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:52px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:2px;color:${MUTED};text-transform:uppercase;">${escapeHtml(input.eyebrow)}</td></tr></table>
      <h1 class="wx-h1" style="margin:0;padding:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:36px;line-height:42px;font-weight:800;letter-spacing:-1px;color:${INK};">${escapeHtml(input.heading)}</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:18px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:${BODY};">${escapeHtml(input.greeting)} ${escapeHtml(input.body)}</td></tr></table>
      ${action ? actionButton(action) : ""}
      ${details}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${security}${action ? rawLinkFallback(action) : ""}</table>
    </td></tr><tr><td class="wx-foot-pad" style="padding:28px 52px 0 52px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${FAINT};"><span style="color:${BODY};font-weight:bold;">${BRAND}</span> &nbsp;&middot;&nbsp; Real demand, found.<br><a href="https://wanterest.com" target="_blank" style="color:${FAINT};text-decoration:none;">wanterest.com</a></td></tr></table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body>
</html>`;
}

function renderText(input: EmailShellInput): string {
  const action = input.action ? { ...input.action, href: safeAbsoluteUrl(input.action.href) } : null;
  return [
    `${BRAND} — ${plainText(input.eyebrow)}`,
    "",
    plainText(input.heading),
    "",
    `${plainText(input.greeting)} ${plainText(input.body)}`,
    action ? `\n${plainText(action.label)}:\n${action.href}` : "",
    input.detailTitle && input.detailBody ? `\n${plainText(input.detailTitle)}\n${plainText(input.detailBody)}` : "",
    input.security ? `\n${plainText(input.security)}` : "",
    "\n—",
    `${BRAND} · Real demand, found.`,
    "https://wanterest.com",
  ].join("\n");
}

export function earlyAccessVerificationEmail(input: { firstName: string; verificationUrl: string; expiresInHours: number }): TransactionalEmailContent {
  const firstName = plainText(input.firstName) || "there";
  const shell: EmailShellInput = {
    title: "Confirm your Wanterest Early Access request",
    preview: "Confirm your email to secure your Early Access place. One click.",
    eyebrow: "Early Access",
    heading: "Confirm your place.",
    greeting: `Hi ${firstName},`,
    body: "thanks for requesting Wanterest Early Access. Confirm this is your email and your place in line is secured.",
    action: { label: "Confirm Early Access", href: input.verificationUrl },
    detailTitle: "What happens next",
    detailBody: "Your permanent Early Access number is recorded when you confirm. We review requests and open access in waves. No workspace or dashboard is created until you are invited.",
    security: `This link expires in ${Math.max(1, Math.trunc(input.expiresInHours))} hours. If you did not request Wanterest Early Access, you can ignore this email. Nothing will happen.`,
  };
  return { subject: shell.title, html: renderHtml(shell), text: renderText(shell) };
}

export function earlyAccessVerifiedEmail(input: { firstName: string; earlyAccessNumber: number }): TransactionalEmailContent {
  const firstName = plainText(input.firstName) || "there";
  if (!Number.isSafeInteger(input.earlyAccessNumber) || input.earlyAccessNumber < 1) {
    throw new Error("A verified Early Access email requires an authoritative positive identity number.");
  }
  const number = `#${String(input.earlyAccessNumber).padStart(4, "0")}`;
  const shell: EmailShellInput = {
    title: "Your Wanterest Early Access place is recorded",
    preview: `Your permanent Early Access number is ${number}.`,
    eyebrow: "Early Access",
    heading: "Your place is recorded.",
    greeting: `Hi ${firstName},`,
    body: `your email is confirmed and your permanent Early Access number is ${number}.`,
    detailTitle: "What happens next",
    detailBody: "We review requests and open access in waves. Your Early Access number is a historical identity, not dashboard access or a product permission.",
  };
  return { subject: shell.title, html: renderHtml(shell), text: renderText(shell) };
}

export function invitationEmail(input: { firstName: string; companyName: string; inviteUrl: string; expiresAt: string }): TransactionalEmailContent {
  const firstName = plainText(input.firstName) || "there";
  const companyName = plainText(input.companyName) || "your workspace";
  const expiry = formatExpiry(input.expiresAt);
  const shell: EmailShellInput = {
    title: "Your Wanterest invitation is ready",
    preview: "Accept your Wanterest invitation and begin setting up your workspace.",
    eyebrow: "Invite ready",
    heading: "You are in.",
    greeting: `Hi ${firstName},`,
    body: `your invitation for ${companyName} is ready. Accept it using the account you want to use for Wanterest.`,
    action: { label: "Accept invitation", href: input.inviteUrl },
    detailTitle: "What happens next",
    detailBody: "After you accept, Wanterest creates your authorized workspace access. Any cohort identity is created only by the admission service.",
    security: `This invitation expires ${expiry} and can be used once. If you did not expect this invitation, do not use the link.`,
  };
  return { subject: shell.title, html: renderHtml(shell), text: renderText(shell) };
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return `on ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
