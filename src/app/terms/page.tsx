import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { LEGAL_LAST_UPDATED_LABEL } from "@/shared/config/seo";
import { SUPPORT_EMAIL } from "@/shared/config/site";

const TITLE = "Terms of Service — Wanterest";
const DESCRIPTION = "Read the terms governing use of Wanterest, subscriptions, demand intelligence, public-source data, account responsibilities, and service access.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/terms" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function TermsPage() {
  return (
    <MarketingPageShell>
      <main>
        <section className="marketing-section is-tight">
          <div className="marketing-section-inner marketing-section-readable marketing-legal">
            <h1 className="marketing-display-title marketing-section-title" style={{ textAlign: "left" }}>Terms of Service</h1>
            <p className="marketing-legal-updated">Last updated: {LEGAL_LAST_UPDATED_LABEL}</p>

            <p>
              These Terms govern your access to and use of Wanterest (the &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to
              these Terms.
            </p>

            <h2>Accounts</h2>
            <p>
              You must provide accurate information when creating an account and are responsible for keeping your login credentials secure. You are
              responsible for activity that happens under your account.
            </p>

            <h2>Workspace responsibility</h2>
            <p>
              A workspace may have multiple members. The workspace owner and its members are jointly responsible for the workspace&rsquo;s use of the
              Service, including which products are configured and who has access.
            </p>

            <h2>Acceptable use</h2>
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>Attempt to gain unauthorized access to another workspace&rsquo;s data or to Wanterest&rsquo;s systems.</li>
              <li>Interfere with or disrupt the Service, or attempt to bypass usage limits or entitlement checks.</li>
              <li>Use the Service for unlawful purposes, or to process content you do not have the right to process.</li>
              <li>Submit a product website or context you are not authorized to analyze.</li>
            </ul>

            <h2>Public-source intelligence</h2>
            <p>
              The Service discovers and analyzes publicly available conversations and content from third-party platforms to generate demand intelligence.
              Wanterest does not control, and is not responsible for, the accuracy, availability, or continued accessibility of third-party public content.
            </p>

            <h2>Generated and analytical output</h2>
            <p>
              Signals, themes, maps, gaps, drift, and suggested actions produced by the Service are analytical outputs generated from public-source
              evidence and automated qualification. They are provided to help inform your decisions, not as guaranteed facts, market research, or
              professional advice. You are responsible for how you interpret and act on this output.
            </p>

            <h2>Product information you submit</h2>
            <p>
              You represent that you have the right to submit the product website and context you provide to the Service, and that doing so does not
              violate any agreement you have with a third party.
            </p>

            <h2>Subscriptions and plans</h2>
            <p>
              The Service is offered on Free, Pro, and Growth plans, each with its own capabilities and usage limits as described on our{" "}
              <a href="/pricing">Pricing</a> page. Plan capabilities may change over time; we will not reduce the capabilities of a plan you are actively
              subscribed to without reasonable notice.
            </p>

            <h2>Billing and renewal</h2>
            <p>
              Paid plans are billed through Dodo Payments, our payment provider and merchant of record, on a monthly or annual cycle as selected at
              checkout. Subscriptions renew automatically at the end of each billing period unless cancelled beforehand.
            </p>

            <h2>Cancellation</h2>
            <p>
              You may cancel a paid plan at any time through the billing settings in your workspace. Cancellation stops future renewal; unless required
              otherwise by law or stated at checkout, we do not commit to a specific refund policy for the remainder of an already-paid period in these
              Terms — refund handling, if any, follows the terms presented by Dodo Payments at the time of purchase.
            </p>

            <h2>Plan changes</h2>
            <p>Upgrading or downgrading your plan changes your available capabilities and usage limits according to the new plan, effective as described at the time of the change.</p>

            <h2>Fair use and usage limits</h2>
            <p>
              Each plan has defined limits (for example, number of products, manual scans, and monitoring frequency). We may throttle, queue, or reject
              requests that exceed your plan&rsquo;s limits, and may take action against use that we reasonably believe is abusive or intended to
              circumvent those limits.
            </p>

            <h2>Automatic monitoring</h2>
            <p>
              Where enabled by your plan, the Service periodically re-scans configured products in the background. Monitoring frequency and depth depend
              on your plan and may change if your plan changes.
            </p>

            <h2>Intellectual property</h2>
            <p>
              Wanterest retains all rights to the Service, including its software, design, and underlying methodology. You retain rights to the product
              information you submit; you grant us the right to process it as necessary to provide the Service to you.
            </p>

            <h2>Your responsibility for decisions</h2>
            <p>
              Any product, positioning, or growth decisions you make based on Wanterest&rsquo;s intelligence or suggested actions are your own. Wanterest
              is not liable for business outcomes resulting from decisions made using the Service.
            </p>

            <h2>Prohibited abuse</h2>
            <p>
              We may suspend or terminate accounts that abuse the Service, attempt to circumvent usage limits, misuse public-source data, or otherwise
              violate these Terms.
            </p>

            <h2>Service availability</h2>
            <p>
              We aim to keep the Service available and reliable but do not guarantee uninterrupted access. Scheduled maintenance, third-party provider
              outages, or unforeseen issues may cause temporary disruption.
            </p>

            <h2>Modifications to the Service</h2>
            <p>We may add, change, or remove features of the Service over time as the product evolves.</p>

            <h2>Termination</h2>
            <p>
              You may stop using the Service at any time. We may suspend or terminate access for violation of these Terms, non-payment, or as required by
              law.
            </p>

            <h2>Disclaimers</h2>
            <p>
              The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied, including fitness for a particular purpose
              or that generated intelligence will be complete, accurate, or error-free.
            </p>

            <h2>Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Wanterest is not liable for indirect, incidental, or consequential damages arising from your use of
              the Service, and our total liability for any claim is limited to the amount you paid us in the twelve months before the claim arose.
            </p>

            <h2>Changes to these Terms</h2>
            <p>We may update these Terms from time to time. We will update the &ldquo;Last updated&rdquo; date above when we do.</p>

            <h2>Contact</h2>
            <p>
              Questions about these Terms can be sent to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>

            <p style={{ fontStyle: "italic" }}>
              Legal entity name, registered address, and governing jurisdiction are not yet finalized in this document and require founder/legal
              confirmation before this policy should be treated as complete.
            </p>
          </div>
        </section>
      </main>
    </MarketingPageShell>
  );
}
