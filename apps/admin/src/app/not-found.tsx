import Link from "next/link";

export default function NotFound() {
  return <main className="login-page"><section className="login-card"><p className="eyebrow">NOT FOUND</p><h1>This page isn’t here.</h1><p className="lede">Return to the Wanterest Admin overview.</p><Link className="back-link" href="/">Go to overview <span aria-hidden="true">→</span></Link></section></main>;
}
