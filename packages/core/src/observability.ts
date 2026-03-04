export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  correlationId?: string;
  sessionId?: string;
  entryId?: string;
  toolCallId?: string;
  extensionId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface Span {
  context: SpanContext;
  name: string;
  startTime: string;
  endTime?: string;
  attributes: Record<string, unknown>;
  end(): void;
}

export interface MetricSample {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: string;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(correlationId: string): Logger;
}

export interface Tracer {
  startSpan(name: string, parent?: SpanContext): Span;
}

export interface MetricsHook {
  record(name: string, value: number, tags?: Record<string, string>): void;
  flush(): MetricSample[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeSpanId(): string {
  return Math.random().toString(16).slice(2, 18);
}

export class InMemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  private readonly correlationId: string;

  constructor(correlationId = "") {
    this.correlationId = correlationId;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  child(correlationId: string): Logger {
    const child = new InMemoryLogger(correlationId);
    child.entries.push(...this.entries);
    return child;
  }

  private log(
    level: LogEntry["level"],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.entries.push({
      level,
      message,
      correlationId: this.correlationId || undefined,
      timestamp: nowIso(),
      data,
    });
  }
}

export class InMemoryTracer implements Tracer {
  readonly spans: Span[] = [];

  startSpan(name: string, parent?: SpanContext): Span {
    const context: SpanContext = {
      traceId: parent?.traceId ?? makeSpanId(),
      spanId: makeSpanId(),
      parentSpanId: parent?.spanId,
    };

    const span: Span = {
      context,
      name,
      startTime: nowIso(),
      attributes: {},
      end() {
        span.endTime = nowIso();
      },
    };

    this.spans.push(span);
    return span;
  }
}

export class InMemoryMetricsHook implements MetricsHook {
  private readonly samples: MetricSample[] = [];

  record(
    name: string,
    value: number,
    tags: Record<string, string> = {},
  ): void {
    this.samples.push({ name, value, tags, timestamp: nowIso() });
  }

  flush(): MetricSample[] {
    const drained = [...this.samples];
    this.samples.length = 0;
    return drained;
  }
}

export function createLogger(correlationId?: string): Logger {
  return new InMemoryLogger(correlationId);
}

export function createTracer(): Tracer {
  return new InMemoryTracer();
}

export function createMetricsHook(): MetricsHook {
  return new InMemoryMetricsHook();
}
