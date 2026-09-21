import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  body: string;
  cta?: { label: string; href: string };
  children?: ReactNode;
};

export function EmptyState({ title, body, cta, children }: Props) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {cta ? <Link className="dashboard-button dashboard-button-primary" href={cta.href}>{cta.label}</Link> : null}
      {children}
    </div>
  );
}
