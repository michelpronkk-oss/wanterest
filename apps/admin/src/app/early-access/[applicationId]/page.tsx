import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ConsoleShell, DataState, PageHeading, SourceStamp } from "@admin/components/console-shell";
import { requireAdminPermission } from "@admin/server/auth";
import { getEarlyAccessDetail } from "@admin/server/early-access";
import { applyEarlyAccessAction } from "@admin/server/lifecycle-actions";

export const dynamic = "force-dynamic";

export default async function EarlyAccessDetailPage({ params, searchParams }: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const context = await requireAdminPermission("lifecycle.read");
  const [{ applicationId }, query] = await Promise.all([params, searchParams]);
  const snapshot = await getEarlyAccessDetail(applicationId);
  if (!snapshot.detail) return <ConsoleShell context={context} active="/early-access">
    <PageHeading eyebrow="LIFECYCLE / EARLY ACCESS" title="Application unavailable." detail={snapshot.error ?? "The application could not be loaded."} aside={<Link className="quiet-link" href="/early-access">← Early Access</Link>} />
    <DataState state="unavailable" detail={snapshot.error ?? "This application is unavailable."} />
  </ConsoleShell>;

  const { row, history, historyError } = snapshot.detail;
  const isOperator = context.role === "founder" || context.role === "operations_admin";
  const activeInvite = row.inviteStatus === "issued";
  return <ConsoleShell context={context} active="/early-access">
    <PageHeading eyebrow={`LIFECYCLE / APPLICATION #${row.number ?? "—"}`} title={`${row.firstName} · ${row.company}`} detail="Private applicant record, authoritative lifecycle history and permitted next actions." aside={<Link className="quiet-link" href="/early-access">← All applications</Link>} />
    {query.result && <DetailActionNotice result={query.result} />}
    <div className="lifecycle-detail-grid">
      <section className="panel lifecycle-record" aria-labelledby="record-heading">
        <div className="panel-heading"><div><p className="eyebrow">CURRENT RECORD</p><h2 id="record-heading">Lifecycle status</h2></div><span className={`status-chip status-${row.status}`}>{row.status.replaceAll("_", " ")}</span></div>
        <dl className="detail-facts">
          <div><dt>Application</dt><dd>#{row.number ?? "Unnumbered"}</dd></div>
          <div><dt>Submitted</dt><dd>{formatDate(row.createdAt)}</dd></div>
          <div><dt>Email verification</dt><dd>{row.emailVerified ? `Verified ${snapshot.detail.verifiedAt ? formatDate(snapshot.detail.verifiedAt) : ""}` : "Not verified"}</dd></div>
          <div><dt>Verified referrals</dt><dd>{row.verifiedReferrals === null ? "Unavailable" : `${row.verifiedReferrals} · ${row.verifiedReferrals} of 3 toward automatic Priority`}</dd></div>
          <div><dt>Priority</dt><dd>{row.priorityStatus ?? "Unavailable"}</dd></div>
          <div><dt>Invitation</dt><dd>{row.inviteStatus ?? "No invitation issued"}</dd></div>
          <div><dt>Admission</dt><dd>{snapshot.detail.admissionId ? `Admitted ${row.admittedAt ? formatDate(row.admittedAt) : ""}` : "Not admitted"}</dd></div>
          {snapshot.detail.workspaceId && <div><dt>Workspace</dt><dd><code>{snapshot.detail.workspaceId}</code></dd></div>}
          <div><dt>Permanent cohort</dt><dd>{row.cohort ? `${row.cohort.replaceAll("_", " ")} · seat ${row.cohortNumber}` : "Assigned only during admission"}</dd></div>
        </dl>
        {snapshot.detail.admissionId && <p className="inline-note">Invitation acceptance already created this workspace admission and its permanent cohort seat in one transaction. There is no separate manual admission action.</p>}
      </section>

      <section className="panel lifecycle-actions-panel" aria-labelledby="actions-heading">
        <div className="panel-heading"><div><p className="eyebrow">CONTROLLED OPERATIONS</p><h2 id="actions-heading">Next valid action</h2></div></div>
        {isOperator ? <>
          {row.status === "verified" && row.emailVerified && <div className="action-stack">
            <ActionForm applicationId={row.id} operation="approve" label="Approve for invitation" confirmText="Move this verified application through review to approved for invitation." />
            <ActionForm applicationId={row.id} operation="hold" label="Put on hold" confirmText="Move this verified application into review." requireReason />
            <ActionForm applicationId={row.id} operation="reject" label="Reject application" confirmText="Move this application through review to declined. This cannot be undone here." requireReason destructive />
          </div>}
          {row.status === "under_review" && <div className="action-stack">
            <ActionForm applicationId={row.id} operation="approve" label="Approve for invitation" confirmText="Approve this application for invitation." />
            <ActionForm applicationId={row.id} operation="reject" label="Reject application" confirmText="Move this application to declined. This cannot be undone here." requireReason destructive />
          </div>}
          {row.status === "approved_for_invite" && !snapshot.detail.admissionId && <div className="action-stack">
            {activeInvite
              ? <>
                <ActionForm applicationId={row.id} operation="resend" label="Resend invitation" confirmText="Create a replacement invite link, revoke the previous pending link and send the new link by email." />
                {snapshot.detail.latestInviteId && <ActionForm applicationId={row.id} inviteId={snapshot.detail.latestInviteId} operation="revoke" label="Revoke pending invitation" confirmText="Revoke the currently issued invitation. It cannot be accepted after revocation." requireReason destructive />}
              </>
              : <ActionForm applicationId={row.id} operation="send" label="Send invitation" confirmText="Issue a single-use, seven-day invitation and send it to the verified applicant email." />}
          </div>}
          {row.status === "accepted" || snapshot.detail.admissionId ? <p className="inline-note">Already admitted. Workspace and cohort identity are read from the admission records above.</p> : null}
          {!(["verified", "under_review", "approved_for_invite", "accepted"].includes(row.status)) && !snapshot.detail.admissionId && <p className="inline-note">There is no lifecycle action available for the current state.</p>}
        </> : <p className="inline-note">Your active Admin role is read-only for lifecycle operations.</p>}
        <p className="action-security-note">Every action rechecks Admin membership and AAL2 on the server. Changes use the existing lifecycle service and write an append-only audit record.</p>
      </section>
    </div>

    <section className="panel lifecycle-history-panel" aria-labelledby="history-heading">
      <div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY HISTORY</p><h2 id="history-heading">Application, invitation and Admin activity</h2></div><span className="panel-meta">Oldest first · UTC</span></div>
      {history === null ? <DataState state="unavailable" detail={historyError ?? "The lifecycle audit history is unavailable."} /> : history.length === 0 ? <DataState state="empty" detail="No lifecycle events have been recorded yet." /> : <ol className="lifecycle-timeline">
        {history.map((item) => <li key={item.id}>
          <span className={`timeline-mark ${item.kind}`} aria-hidden="true" />
          <div><div className="timeline-heading"><strong>{item.action}</strong>{item.status && <span className="status-chip">{item.status.replaceAll("_", " ")}</span>}</div>
            {item.reason && <p>{item.reason}</p>}
            <small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(item.createdAt))} UTC · {item.kind === "admin" ? "Admin audit" : item.kind === "invitation" ? "Admission invitation" : "Application event"}</small>
          </div>
        </li>)}
      </ol>}
      <SourceStamp source="Supabase production · append-only application and Admin audit records" range="This application" refreshedAt={snapshot.checkedAt} />
    </section>
  </ConsoleShell>;
}

function ActionForm({ applicationId, inviteId = "", operation, label, confirmText, requireReason = false, destructive = false }: {
  applicationId: string; inviteId?: string; operation: "approve" | "hold" | "reject" | "send" | "resend" | "revoke";
  label: string; confirmText: string; requireReason?: boolean; destructive?: boolean;
}) {
  return <details className="lifecycle-action">
    <summary className={destructive ? "is-destructive" : undefined}>{label}<span aria-hidden="true">⌄</span></summary>
    <form action={applyEarlyAccessAction} className="lifecycle-action-form">
      <p>{confirmText}</p>
      {requireReason && <label className="reason-label">Internal reason<textarea name="reason" required minLength={1} maxLength={500} rows={3} /></label>}
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="inviteId" value={inviteId} />
      <input type="hidden" name="action" value={operation} />
      <input type="hidden" name="requestId" value={randomUUID()} />
      {!requireReason && <input type="hidden" name="reason" value="" />}
      <label className="confirm-action-label"><input type="checkbox" name="confirm" value="yes" required /> I have reviewed the transition above and confirm this action.</label>
      <button className={`filter-button lifecycle-confirm${destructive ? " is-destructive" : ""}`} type="submit">Confirm {label}</button>
    </form>
  </details>;
}

function DetailActionNotice({ result }: { result: string }) {
  const messages: Record<string, string> = {
    updated: "Lifecycle transition saved and audited.", sent: "Invitation issued and email delivery recorded.", resent: "Replacement invitation issued and sent; the previous link was revoked.",
    revoked: "Pending invitation revoked and audited.", "already-recorded": "This action request was already completed. No duplicate mutation was performed.",
    "delivery-failed": "Invitation issued, but email delivery failed. Resending creates a new link; review the audit timeline first.",
    "delivery-audit-unavailable": "Invitation issued, but delivery audit could not be recorded. Review audit history before acting again.",
    "invalid-transition": "The lifecycle state no longer allows this action. Review the current record and audit history.",
    "reason-required": "Provide an internal reason to continue.", unavailable: "The operation could not be confirmed. Refresh this record and inspect its latest state before retrying.", invalid: "The submitted operation was not valid.",
  };
  const text = messages[result];
  return text ? <p className={`action-notice${result.includes("failed") || result === "unavailable" ? " is-error" : ""}`} role="status">{text}</p> : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
