import { AsyncLocalStorage } from "node:async_hooks";

export type PerformanceAuditSnapshot = {
  route: string;
  totalDurationMs: number;
  repositoryCalls: number;
  rowsReturned: number;
  dependencies: Array<{ name: string; durationMs: number; rows: number | null }>;
};

type Dependency = { name: string; durationMs: number; rows: number | null };

class PerformanceAudit {
  private readonly startedAt = performance.now();
  private repositoryCalls = 0;
  private rowsReturned = 0;
  private readonly dependencies: Dependency[] = [];

  constructor(private readonly route: string) {}

  async measure<T>(name: string, operation: () => Promise<T>, rows?: (value: T) => number | null): Promise<T> {
    const startedAt = performance.now();
    try {
      const value = await operation();
      const rowCount = rows?.(value) ?? null;
      if (rowCount !== null) this.rowsReturned += rowCount;
      this.dependencies.push({ name, durationMs: Math.round((performance.now() - startedAt) * 100) / 100, rows: rowCount });
      return value;
    } finally {
      this.repositoryCalls += 1;
    }
  }

  snapshot(): PerformanceAuditSnapshot {
    return {
      route: this.route,
      totalDurationMs: Math.round((performance.now() - this.startedAt) * 100) / 100,
      repositoryCalls: this.repositoryCalls,
      rowsReturned: this.rowsReturned,
      dependencies: [...this.dependencies],
    };
  }
}

const storage = new AsyncLocalStorage<PerformanceAudit>();

/** Request-scoped, opt-in timing. It never records payloads, evidence content, or credentials. */
export async function withPerformanceAudit<T>(route: string, operation: () => Promise<T>): Promise<{ value: T; audit: PerformanceAuditSnapshot }> {
  const audit = new PerformanceAudit(route);
  const value = await storage.run(audit, operation);
  return { value, audit: audit.snapshot() };
}

export async function measurePerformance<T>(name: string, operation: () => Promise<T>, rows?: (value: T) => number | null): Promise<T> {
  const audit = storage.getStore();
  return audit ? audit.measure(name, operation, rows) : operation();
}

export function logPerformanceAudit(snapshot: PerformanceAuditSnapshot): void {
  if (process.env.NODE_ENV === "production" && process.env.WANTEREST_PERF_AUDIT !== "true") return;
  console.info("[performance-audit]", snapshot);
}
