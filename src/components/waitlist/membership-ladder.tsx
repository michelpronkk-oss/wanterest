import { LogoMark } from "@/components/dashboard/nav-icons";

/**
 * The four-tier ladder from the approved Early Access design. Deliberately carries no numbers —
 * the design's "07"/"042" badges are illustrative mockup flavor only. Cohort numbers are assigned
 * at admission, never shown here as if they belonged to the person reading this page.
 */
const TIERS = [
  {
    key: "founding",
    badge: <span className="ea-ladder-badge is-founding"><LogoMark size={13} /><span>FOUNDING 25</span></span>,
    title: "Founding 25.",
    body: "The first 25 admitted workspaces.",
  },
  {
    key: "early",
    badge: <span className="ea-ladder-badge is-early"><LogoMark size={13} /><span>EARLY 100</span></span>,
    title: "Early 100.",
    body: "The next 100 admitted. Permanent.",
  },
  {
    key: "priority",
    badge: <span className="ea-ladder-badge is-priority"><span className="ea-ladder-dot" aria-hidden="true" />Priority access</span>,
    title: "Priority.",
    body: "Moved forward in review.",
  },
  {
    key: "early-access",
    badge: <span className="ea-ladder-badge is-default">Early access</span>,
    title: "Early Access.",
    body: "Where everyone starts.",
  },
] as const;

export function MembershipLadder() {
  return (
    <div className="ea-ladder" aria-label="How membership works">
      <div className="ea-ladder-heading">How membership works</div>
      {TIERS.map((tier) => (
        <div className="ea-ladder-row" key={tier.key}>
          {tier.badge}
          <div className="ea-ladder-copy">
            <strong>{tier.title}</strong>
            <span>{tier.body}</span>
          </div>
        </div>
      ))}
      <p className="ea-ladder-footnote">Cohorts are assigned at admission, never at signup.</p>
    </div>
  );
}
