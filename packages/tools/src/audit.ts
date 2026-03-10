export type AuditDecision = "allow" | "deny";

export interface ToolAuditEvent {
  sessionId: string;
  extensionId: string;
  toolName: string;
  command: string;
  decision: AuditDecision;
  reason?: string;
  redactedFields: string[];
  requestedAt: string;
  decidedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface AuditEventSink {
  emit(event: ToolAuditEvent): Promise<void> | void;
}

export type AuditEventListener = (event: ToolAuditEvent) => void;

export class InMemoryAuditSink implements AuditEventSink {
  private readonly events: ToolAuditEvent[] = [];
  private readonly listeners = new Set<AuditEventListener>();

  emit(event: ToolAuditEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  list(): ToolAuditEvent[] {
    return [...this.events];
  }

  onEvent(listener: AuditEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class CompositeAuditSink implements AuditEventSink {
  constructor(private readonly sinks: AuditEventSink[]) {}

  async emit(event: ToolAuditEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.emit(event);
    }
  }
}
