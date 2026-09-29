import Link from "next/link";
import { AuthShell } from "@admin/components/auth-shell";

export default function ForbiddenPage() {
  return <AuthShell eyebrow="ACCESS CONTROL" title="Access denied." description="Your administrator role does not include permission for this view."><Link className="back-link" href="/login"><span aria-hidden="true">←</span> Return to sign in</Link></AuthShell>;
}
