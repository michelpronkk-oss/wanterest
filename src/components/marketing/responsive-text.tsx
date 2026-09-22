/** Renders the full desktop copy, swapped via CSS for a shorter mobile variant at narrow widths. */
export function ResponsiveText({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="marketing-copy-full">{full}</span>
      <span className="marketing-copy-short">{short}</span>
    </>
  );
}
