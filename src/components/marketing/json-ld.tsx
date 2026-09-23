/** Renders a Schema.org JSON-LD block. Only ever pass truthful, verified data — see docs/architecture.md callers for what is (and isn't) verified. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
