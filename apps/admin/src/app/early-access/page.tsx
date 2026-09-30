import Link from "next/link";
import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { applicationStatuses, getEarlyAccessRows } from "@admin/server/early-access";

export const dynamic = "force-dynamic";

export default async function EarlyAccessPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; result?: string }> }) {
  const context = await requireAdminPermission("lifecycle.read");
  const params = await searchParams;
  const selectedStatus = applicationStatuses.includes(params.status as (typeof applicationStatuses)[number]) ? params.status! : "all";
  const snapshot = await getEarlyAccessRows({ query: params.q ?? "", status: selectedStatus });
  return (
    <ConsoleShell context={context} active="/early-access">
      <PageHeading eyebrow="LIFECYCLE / EARLY ACCESS" title="People before the product." detail="Authoritative applications, referral progress, invitations and admitted workspaces from production lifecycle records." aside={<Link className="quiet-link" href="/">← Overview</Link>} />
      {params.result && <ActionNotice result={params.result} />}
      <section className="panel lifecycle-panel" aria-labelledby="applications-heading">
        <div className="panel-heading lifecycle-heading"><div><p className="eyebrow">APPLICATIONS</p><h2 id="applications-heading">Early Access queue</h2></div><span className="panel-meta">Latest 30 records · newest first</span></div>
        <form className="table-filters" method="get" role="search">
          <label className="search-field"><span className="sr-only">Search name, company or email</span><span aria-hidden="true">⌕</span><input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Search name, company or email" maxLength={80} /></label>
          <label><span className="sr-only">Filter application status</span><select name="status" defaultValue={selectedStatus}><option value="all">All statuses</option>{applicationStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <button className="filter-button" type="submit">Apply filters</button>
        </form>
        {snapshot.rows === null ? <DataState state="unavailable" detail={snapshot.error ?? "Supabase production records are unavailable."} /> : snapshot.rows.length === 0 ? <DataState state="empty" detail="No applications matched this search and status." /> : (
          <>
            <div className="table-scroll" tabIndex={0} aria-label="Scrollable applicant results"><table className="access-table"><thead><tr><th scope="col">Applicant</th><th scope="col">Application</th><th scope="col">Referral progress</th><th scope="col">Invitation</th><th scope="col">Admission &amp; cohort</th></tr></thead><tbody>
              {snapshot.rows.map((row) => <tr key={row.id}>
                <td><div className="applicant-name"><strong><Link href={`/early-access/${row.id}`}>{row.firstName}</Link></strong><span>{row.company}</span></div><small>#{row.number ?? "Unnumbered"} · {row.emailVerified ? "Email verified" : "Unverified"}</small><small><Link className="text-link" href={`/early-access/${row.id}`}>Review record →</Link></small></td>
                <td><span className={`status-chip status-${row.status}`}>{row.status.replaceAll("_", " ")}</span><small>{formatDate(row.createdAt)}</small></td>
                <td>{row.verifiedReferrals === null ? <span className="dim-value">Not available</span> : <strong>{row.verifiedReferrals} <span className="dim-value">verified</span></strong>}<small>{row.priorityStatus ? `Priority ${row.priorityStatus}` : "Priority status unavailable"}</small></td>
                <td>{row.inviteStatus ? <span className="status-chip">{row.inviteStatus}</span> : <span className="dim-value">None recorded</span>}<small>{row.inviteStatus ? "Latest invitation" : "No invitation record"}</small></td>
                <td>{row.admittedAt ? <strong>Admitted</strong> : <span className="dim-value">Not admitted</span>}<small>{row.cohort ? `${row.cohort.replaceAll("_", " ")} · seat ${row.cohortNumber}` : row.admittedAt ? formatDate(row.admittedAt) : "No cohort membership"}</small></td>
              </tr>)}
            </tbody></table></div>
            <p className="results-note">Showing {snapshot.rows.length} of up to 30 most recent matches. Search is performed server-side; email is never returned to the browser.</p>
          </>
        )}
        <SourceStamp source="Supabase production · waitlist_applications + referral status + invitations + admissions + cohort memberships" range="Current rows · latest 30" refreshedAt={snapshot.checkedAt} />
      </section>
      <p className="data-footnote">Priority remains automatic under the existing referral policy. Invitation acceptance creates the workspace admission and permanent cohort assignment atomically; this console does not choose a cohort seat.</p>
    </ConsoleShell>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

function ActionNotice({ result }: { result: string }) {
  const copy: Record<string, string> = {
    updated: "The application lifecycle update was recorded.", sent: "The invitation was issued and delivered.", resent: "A replacement invitation was issued and delivered.",
    revoked: "The pending invitation was revoked.", "already-recorded": "This request was already recorded; no duplicate operation was performed.",
    "delivery-failed": "The invitation was created, but delivery failed. Resend it to rotate the link and try again.",
    "delivery-audit-unavailable": "The invitation was created, but its delivery outcome could not be recorded. Review the audit history before taking another action.",
    "invalid-transition": "The record changed or this operation is not allowed in its current state. Review the current lifecycle history.",
    "reason-required": "Add an internal reason before confirming this action.", unavailable: "The operation could not be completed. No success was reported; reload the record and review its current state.",
    invalid: "The submitted operation was not valid.",
  };
  const message = copy[result];
  if (!message) return null;
  return <p className={`action-notice${result.includes("failed") || result === "unavailable" ? " is-error" : ""}`} role="status">{message}</p>;
}
