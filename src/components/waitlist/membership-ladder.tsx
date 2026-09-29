import { CohortBadge, EarlyAccessPill, PriorityPill } from "@/components/members/member-identity-slots";

/**
 * The four-tier ladder from the approved Early Access design, drawn with the Apex 2.0 badge family
 * (board 02/03): Apex pills for the two permanent cohorts, the signal-dot Priority pill and the
 * hollow Early Access pill. Deliberately carries no numbers — cohort numbers are assigned at
 * admission, never shown here as if they belonged to the person reading this page.
 */
const TIERS = [
  {
    key: "founding",
    badge: <CohortBadge cohort="founding_25" />,
    title: "Founding 25.",
    body: "The first 25 admitted workspaces.",
  },
  {
    key: "early",
    badge: <CohortBadge cohort="early_100" />,
    title: "Early 100.",
    body: "The next 100 admitted. Permanent.",
  },
  {
    key: "priority",
    badge: <PriorityPill status="granted" />,
    title: "Priority.",
    body: "Moved forward in review.",
  },
  {
    key: "early-access",
    badge: <EarlyAccessPill />,
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
