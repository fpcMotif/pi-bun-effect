import {
  createLogger,
  createMetricsHook,
  createTracer,
  InMemoryLogger,
} from "@pi-bun-effect/core";
import { expect, test } from "bun:test";

test("logger child preserves prior history and uses its own correlation id", () => {
  const logger = createLogger("root") as InMemoryLogger;
  logger.info("root message");

  const child = logger.child("child") as InMemoryLogger;
  child.warn("child message");

  expect(logger.entries).toHaveLength(1);
  expect(logger.entries[0]?.correlationId).toBe("root");
  expect(child.entries).toHaveLength(2);
  expect(child.entries[0]?.message).toBe("root message");
  expect(child.entries[1]?.correlationId).toBe("child");
});

test("tracer links parent and child spans", () => {
  const tracer = createTracer();
  const parent = tracer.startSpan("parent");
  const child = tracer.startSpan("child", parent.context);

  child.end();
  parent.end();

  expect(parent.context.traceId).toBe(child.context.traceId);
  expect(child.context.parentSpanId).toBe(parent.context.spanId);
  expect(child.endTime).toBeDefined();
});

test("metrics hook flush drains recorded samples", () => {
  const metrics = createMetricsHook();
  metrics.record("latency_ms", 12, { route: "rpc" });
  metrics.record("latency_ms", 8, { route: "search" });

  const flushed = metrics.flush();
  expect(flushed).toHaveLength(2);
  expect(flushed[0]?.tags.route).toBe("rpc");
  expect(metrics.flush()).toEqual([]);
});
