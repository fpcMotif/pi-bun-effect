export type AuditOutcome = "allow" | "deny" | "success" | "error";

export interface AuditCorrelationIds {
  sessionId?: string;
  requestId?: string;
}

export type AuditEventType =
  | "policy.command.check"
  | "tools.registry.execute";

export interface AuditEvent {
  type: AuditEventType;
  at: string;
  extensionId: string;
  capability?: string;
  command?: string;
  toolName?: string;
  outcome: AuditOutcome;
  reason?: string;
  correlationIds: AuditCorrelationIds;
  metadata?: Record<string, unknown>;
}

export interface AuditLogger {
  emit(event: AuditEvent): void;
}

export class NoopAuditLogger implements AuditLogger {
  emit(_event: AuditEvent): void {
    return;
  }
}

export class InMemoryAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];

  emit(event: AuditEvent): void {
    this.events.push(event);
  }
}

function redactUnknown(
  key: string,
  value: unknown,
  secrets: string[],
): unknown {
  if (secrets.some((secret) => key.toLowerCase().includes(secret))) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(key, item, secrets));
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      next[childKey] = redactUnknown(childKey, childValue, secrets);
    }
    return next;
  }

  return value;
}

export function redactMetadata(
  metadata: Record<string, unknown>,
  secrets: string[] = ["token", "secret", "password", "authorization"],
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    redacted[key] = redactUnknown(key, value, secrets);
  }

  return redacted;
}

export function nowIso(): string {
  return new Date().toISOString();
}

