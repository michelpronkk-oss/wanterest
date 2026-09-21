export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ui-card ui-card-pad" aria-hidden="true">
      <div style={{ display: "grid", gap: 10 }}>
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} height={index === 0 ? 20 : 12} width={index === lines - 1 ? "60%" : "100%"} />
        ))}
      </div>
    </div>
  );
}
