import { randomUUID } from "node:crypto";

import { redactSecrets } from "./retention";

export type TelemetryEvent = { name: string; traceId: string; workspaceId?: string; sourceKey?: string; durationMs?: number; outcome?: "ok" | "error"; attributes?: Record<string, unknown>; at: string };
export type MetricsSink = { emit(event: TelemetryEvent): void };
export class MemoryMetricsSink implements MetricsSink { readonly events: TelemetryEvent[] = []; emit(event: TelemetryEvent) { this.events.push(event); } }
export function newTraceId() { return randomUUID(); }
export function emitTelemetry(sink: MetricsSink, input: Omit<TelemetryEvent, "at">) { sink.emit({ ...input, attributes: input.attributes ? redactSecrets(input.attributes) as Record<string, unknown> : undefined, at: new Date().toISOString() }); }
export function logStructured(event: TelemetryEvent) { console.info(JSON.stringify(redactSecrets(event))); }
