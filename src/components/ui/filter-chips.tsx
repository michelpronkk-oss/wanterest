export type FilterChip = { key: string; label: string; active: boolean };

export function FilterChipsLinks({ chips, buildHref }: { chips: FilterChip[]; buildHref: (key: string) => string }) {
  return (
    <div className="filter-chips">
      {chips.map((chip) => (
        <a key={chip.key} href={buildHref(chip.key)} className={`filter-chip${chip.active ? " is-active" : ""}`}>
          {chip.label}
        </a>
      ))}
    </div>
  );
}
