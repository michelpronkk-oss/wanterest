import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { LEGAL_LAST_UPDATED_LABEL } from "@/shared/config/seo";
import { SUPPORT_EMAIL } from "@/shared/config/site";

const TITLE = "Privacy Policy — Wanterest";
const DESCRIPTION = "Learn how Wanterest handles account information, product data, public-source intelligence, billing information, cookies, and service data.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/privacy" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function PrivacyPage() {
  return (
    <MarketingPageShell>
      <main>
        <section className="marketing-section is-tight">
          <div className="marketing-section-inner marketing-section-readable marketing-legal">
            <h1 className="marketing-display-title marketing-section-title" style={{ textAlign: "left" }}>Privacy Policy</h1>
            <p className="marketing-legal-updated">Last updated: {LEGAL_LAST_UPDATED_LABEL}</p>

            <p>
              This policy describes how Wanterest (&ldquo;Wanterest,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) handles information when you use our website and product.
              We have written it to describe what actually happens in our systems today, not a generic template.
            </p>

            <h2>Information you provide</h2>
            <p>
              When you create an account, we collect your email address and password (handled by our authentication provider; see &ldquo;Authentication&rdquo; below).
              When you set up a workspace and add a product, you provide a workspace name and a product website URL or description. If you contact us, we
              receive whatever information you include in that message.
            </p>

            <h2>Accounts and workspace information</h2>
            <p>
              Your account is scoped to one or more workspaces. Workspace membership, role, and workspace-level settings are stored so that access to your
              product data and intelligence is restricted to members of that workspace.
            </p>

            <h2>Product URLs and context you submit</h2>
            <p>
              To generate demand intelligence, you give Wanterest a product website (and optionally a short description). We fetch and read the public pages
              of that website to understand your product, audience, and positioning. This snapshot is stored so intelligence can be generated and re-generated
              without repeatedly re-fetching your site.
            </p>

            <h2>Public-source information Wanterest processes</h2>
            <p>
              Wanterest discovers and processes <strong>publicly available</strong> conversations and posts from external platforms (for example, forums,
              question-and-answer sites, developer communities, and public social posts) that are relevant to the product you have configured. We do not
              access private messages, private groups, or non-public content. Raw provider content and normalized versions of it are stored so that the
              intelligence generated from it can be explained, replayed, and traced back to its source.
            </p>

            <h2>Generated demand intelligence</h2>
            <p>
              From the public-source information above, Wanterest generates workspace-specific analysis: qualified signals, themes, market maps, gaps, drift
              over time, and suggested actions. This derived intelligence is workspace-scoped and is not shared across workspaces.
            </p>

            <h2>Authentication</h2>
            <p>
              Account authentication is handled by Supabase Auth. Supabase issues and manages the session cookies that keep you signed in; we do not
              separately store your password.
            </p>

            <h2>Database and storage</h2>
            <p>
              Application data (accounts, workspaces, products, generated intelligence, and billing state) is stored in a PostgreSQL database provided by
              Supabase, with access controls (row-level security) restricting data to the workspace it belongs to.
            </p>

            <h2>Infrastructure and hosting</h2>
            <p>
              The Wanterest web application is hosted on Vercel. Background processing (running scans and building intelligence) is orchestrated by
              Trigger.dev. Both providers process data only as needed to run the service.
            </p>

            <h2>AI/model providers</h2>
            <p>
              Wanterest uses OpenAI&rsquo;s API to help understand product context and analyze conversation content as part of generating demand
              intelligence. We do not control, and cannot make guarantees about, a third-party model provider&rsquo;s internal data-handling practices beyond
              what that provider publishes in its own terms; we send only the content needed to perform the specific analysis.
            </p>

            <h2>Payment and billing</h2>
            <p>
              Subscription billing is handled by Dodo Payments, our payment provider and merchant of record. Wanterest does not store your full payment card
              details; Dodo processes payment information directly and sends Wanterest normalized subscription and billing status.
            </p>

            <h2>Email and notifications</h2>
            <p>
              Where email notifications (such as digests or alerts) are enabled for your workspace, delivery is handled through Resend. If this delivery
              is not configured or enabled, notification emails are not sent.
            </p>

            <h2>Logs and security data</h2>
            <p>
              We keep operational logs and error/trace records to operate, debug, and secure the service. Where practical, these records are redacted to
              avoid retaining sensitive content, provider credentials, or secrets.
            </p>

            <h2>Cookies</h2>
            <p>
              Wanterest currently uses only the cookies required for authentication and session security, set by our authentication provider. See our{" "}
              <a href="/cookies">Cookie Policy</a> for details.
            </p>

            <h2>Analytics</h2>
            <p>
              As of this writing, Wanterest does not use third-party website analytics or advertising tracking. If that changes, this policy and our{" "}
              <a href="/cookies">Cookie Policy</a> will be updated first.
            </p>

            <h2>Why we process this information</h2>
            <ul>
              <li>To provide the core service: generating and displaying demand intelligence for your workspace.</li>
              <li>To operate your account, workspace membership, and subscription.</li>
              <li>To secure the service and investigate abuse or technical issues.</li>
              <li>To respond to support, billing, or general enquiries you send us.</li>
            </ul>

            <h2>Data retention</h2>
            <p>
              Account, workspace, and generated-intelligence data is retained for as long as your workspace is active, so that historical intelligence
              remains available and explainable. We do not currently run automatic, time-based deletion of this data. If you would like your data reviewed,
              exported, or deleted, contact us using the details below and we will handle the request manually. We do not commit to a specific fixed
              retention period beyond this, because no specific period is currently implemented in our systems.
            </p>

            <h2>Security</h2>
            <p>
              We rely on our infrastructure providers&rsquo; standard security controls (for example, encrypted connections in transit and
              access-controlled database policies). We have not obtained third-party security certifications (such as SOC 2) and do not claim to; we
              describe only the safeguards we have actually put in place.
            </p>

            <h2>Your rights</h2>
            <p>
              Depending on where you live, you may have rights to access, correct, export, or delete your personal information, and to object to or
              restrict certain processing. You can exercise these rights by contacting us; see &ldquo;Contact&rdquo; below.
            </p>

            <h2>International processing</h2>
            <p>
              Our infrastructure providers (Supabase, Vercel, Trigger.dev, OpenAI, Dodo Payments, and, where enabled, Resend) may process or store data in
              countries other than your own. We have not independently verified the specific data-residency configuration of every provider, and we do not
              claim a specific data-residency guarantee here.
            </p>

            <h2>Changes to this policy</h2>
            <p>
              We may update this policy as the product or our providers change. We will update the &ldquo;Last updated&rdquo; date above when we do.
            </p>

            <h2>Contact</h2>
            <p>
              Questions about this policy, or requests relating to your data, can be sent to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </div>
        </section>
      </main>
    </MarketingPageShell>
  );
}
