import type { SessionOutboundMessage } from "@otto-code/protocol/messages";

interface RuntimeMetricsLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

interface RuntimeMetricsHandlerTiming {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface RuntimeMetricsBucket {
  inboundMessageCounts: Map<string, number>;
  inboundMessageBytes: Map<string, number>;
  inboundMessageHandlerMs: Map<string, RuntimeMetricsHandlerTiming>;
  inboundAgentStreamCounts: Map<string, number>;
  inboundAgentStreamByAgentCounts: Map<string, number>;
  inboundBinaryFrameCounts: Map<string, number>;
  endedAt: number;
}

interface RuntimeMetricsContext {
  connectionPath: "direct" | "relay";
  serverId: string | null;
  getConnectionStatus: () => string;
}

interface RuntimeMetricsOptions {
  windowMs?: number;
}

/**
 * Session totals, never pruned. The rolling buckets answer "what is happening
 * now"; these answer "what has this connection cost the JS thread since the app
 * started", which is the number you need when the complaint is that the app gets
 * slower the longer it stays open.
 */
export interface DaemonClientTrafficTotals {
  messages: number;
  bytes: number;
  /** Main-thread ms spent inside inbound message handlers. */
  handlerMs: number;
  binaryFrames: number;
  /** Distinct inbound message types seen. */
  types: number;
}

export interface DaemonClientTrafficHotspot {
  type: string;
  count: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
}

/**
 * One inbound session-message dispatch, retained only long enough to align it
 * with a browser Long Animation Frame in the app's performance capture.
 *
 * `at` is an epoch timestamp so callers can compare it directly to the LoAF
 * API. The phase timings are synchronous main-thread work and sum to
 * approximately `totalMs`; small gaps are metric bookkeeping.
 */
export interface DaemonClientInboundDispatchTiming {
  at: number;
  type: string;
  /** Set for agent-scoped messages, so a capture can tell one hot agent from a spread. */
  agentId?: string;
  bytes: number;
  decodeAndValidateMs: number;
  internalDispatchMs: number;
  rawListenersMs: number;
  typedHandlersMs: number;
  totalMs: number;
}

const DEFAULT_ROLLING_WINDOW_MS = 60_000;
/** Bounded independently from rolling log buckets: this is capture evidence, not telemetry. */
export const INBOUND_DISPATCH_TIMING_CAPACITY = 500;

export class DaemonClientRuntimeMetrics {
  private readonly startedAt = Date.now();
  private readonly windowMs: number;
  private readonly buckets: RuntimeMetricsBucket[] = [];
  private readonly inboundMessageCounts = new Map<string, number>();
  private readonly inboundMessageBytes = new Map<string, number>();
  private readonly inboundMessageHandlerMs = new Map<string, RuntimeMetricsHandlerTiming>();
  private readonly inboundAgentStreamCounts = new Map<string, number>();
  private readonly inboundAgentStreamByAgentCounts = new Map<string, number>();
  private readonly inboundBinaryFrameCounts = new Map<string, number>();
  // Cumulative, deliberately outside the bucket pruning above.
  private totalMessages = 0;
  private totalBytes = 0;
  private totalHandlerMs = 0;
  private totalBinaryFrames = 0;
  private readonly cumulativeByType = new Map<string, DaemonClientTrafficHotspot>();
  private readonly inboundDispatchTimings: DaemonClientInboundDispatchTiming[] = [];

  constructor(
    private readonly logger: RuntimeMetricsLogger,
    private readonly context: RuntimeMetricsContext,
    options?: RuntimeMetricsOptions,
  ) {
    this.windowMs =
      typeof options?.windowMs === "number" && options.windowMs > 0
        ? options.windowMs
        : DEFAULT_ROLLING_WINDOW_MS;
  }

  recordMessage(type: string, bytes: number, handlerMs: number): void {
    incrementCount(this.inboundMessageCounts, type, 1);
    incrementCount(this.inboundMessageBytes, type, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, type, handlerMs);
    this.totalMessages += 1;
    this.recordCumulative(type, bytes, handlerMs);
  }

  getTrafficTotals(): DaemonClientTrafficTotals {
    return {
      messages: this.totalMessages,
      bytes: this.totalBytes,
      handlerMs: this.totalHandlerMs,
      binaryFrames: this.totalBinaryFrames,
      types: this.cumulativeByType.size,
    };
  }

  /** Inbound message types ranked by the main-thread time they have cost. */
  getTrafficHotspots(limit = 15): DaemonClientTrafficHotspot[] {
    // Copied out so a caller cannot mutate the running totals.
    const rows: DaemonClientTrafficHotspot[] = [];
    for (const row of this.cumulativeByType.values()) {
      rows.push({
        type: row.type,
        count: row.count,
        totalMs: row.totalMs,
        maxMs: row.maxMs,
        bytes: row.bytes,
      });
    }
    rows.sort((left, right) => right.totalMs - left.totalMs);
    return rows.slice(0, limit);
  }

  recordInboundDispatch(timing: DaemonClientInboundDispatchTiming): void {
    this.inboundDispatchTimings.push(cloneInboundDispatchTiming(timing));
    if (this.inboundDispatchTimings.length > INBOUND_DISPATCH_TIMING_CAPACITY) {
      this.inboundDispatchTimings.splice(
        0,
        this.inboundDispatchTimings.length - INBOUND_DISPATCH_TIMING_CAPACITY,
      );
    }
  }

  /**
   * Recent inbound dispatches for a performance capture. Copies keep capture
   * consumers from mutating a live client's bounded ring.
   */
  getInboundDispatchTimings(sinceMs?: number): DaemonClientInboundDispatchTiming[] {
    return this.inboundDispatchTimings
      .filter((timing) => sinceMs === undefined || timing.at >= sinceMs)
      .map(cloneInboundDispatchTiming);
  }

  // Shared by JSON messages and binary frames; the per-sink totals
  // (`totalMessages` / `totalBinaryFrames`) are bumped by the callers so a
  // binary frame is never counted as both.
  private recordCumulative(type: string, bytes: number, handlerMs: number): void {
    this.totalBytes += bytes;
    this.totalHandlerMs += handlerMs;
    const existing = this.cumulativeByType.get(type);
    if (existing) {
      existing.count += 1;
      existing.bytes += bytes;
      existing.totalMs += handlerMs;
      existing.maxMs = Math.max(existing.maxMs, handlerMs);
      return;
    }
    this.cumulativeByType.set(type, {
      type,
      count: 1,
      bytes,
      totalMs: handlerMs,
      maxMs: handlerMs,
    });
  }

  recordAgentStream(
    payload: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"],
  ): void {
    const { agentId, event } = payload;
    const eventType = event.type === "timeline" ? `timeline:${event.item.type}` : event.type;
    incrementCount(this.inboundAgentStreamCounts, eventType, 1);
    incrementCount(this.inboundAgentStreamByAgentCounts, agentId, 1);
  }

  recordBinaryFrame(kind: string, bytes: number, handlerMs: number): void {
    incrementCount(this.inboundBinaryFrameCounts, kind, 1);
    incrementCount(this.inboundMessageBytes, `binary:${kind}`, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, `binary:${kind}`, handlerMs);
    this.totalBinaryFrames += 1;
    this.recordCumulative(`binary:${kind}`, bytes, handlerMs);
  }

  flush(options?: { final?: boolean }): void {
    const now = Date.now();
    const bucket = this.consumeCurrentBucket(now);
    if (bucket) {
      this.buckets.push(bucket);
    }
    this.pruneBuckets(now);

    const aggregate = this.aggregateBuckets();
    const hasActivity =
      aggregate.inboundMessageCounts.size > 0 || aggregate.inboundBinaryFrameCounts.size > 0;
    if (!hasActivity && !options?.final) {
      return;
    }

    // Debug, not info: the rolling totals are read on demand by the app's
    // Performance Diagnostics Capture (getTrafficTotals), so the periodic line
    // only floods the console for anyone not actively hunting a wire problem.
    this.logger.debug(
      {
        windowMs: Math.min(this.windowMs, Math.max(0, now - this.startedAt)),
        rollingWindowMs: this.windowMs,
        bucketCount: this.buckets.length,
        final: Boolean(options?.final),
        connectionPath: this.context.connectionPath,
        serverId: this.context.serverId,
        connectionStatus: this.context.getConnectionStatus(),
        inboundMessageTypesTop: getTopCounts(aggregate.inboundMessageCounts, 20),
        inboundMessageBytesTop: getTopCounts(aggregate.inboundMessageBytes, 20),
        inboundAgentStreamTypesTop: getTopCounts(aggregate.inboundAgentStreamCounts, 20),
        inboundAgentStreamAgentsTop: getTopCounts(aggregate.inboundAgentStreamByAgentCounts, 20),
        inboundBinaryFrameTypesTop: getTopCounts(aggregate.inboundBinaryFrameCounts, 12),
        handlerTimingTop: getTopHandlerTimings(aggregate.inboundMessageHandlerMs, 20),
      },
      "ws_runtime_metrics_client",
    );
  }

  private consumeCurrentBucket(now: number): RuntimeMetricsBucket | null {
    const hasActivity =
      this.inboundMessageCounts.size > 0 || this.inboundBinaryFrameCounts.size > 0;
    if (!hasActivity) {
      return null;
    }

    const bucket = {
      inboundMessageCounts: new Map(this.inboundMessageCounts),
      inboundMessageBytes: new Map(this.inboundMessageBytes),
      inboundMessageHandlerMs: cloneHandlerTimingMap(this.inboundMessageHandlerMs),
      inboundAgentStreamCounts: new Map(this.inboundAgentStreamCounts),
      inboundAgentStreamByAgentCounts: new Map(this.inboundAgentStreamByAgentCounts),
      inboundBinaryFrameCounts: new Map(this.inboundBinaryFrameCounts),
      endedAt: now,
    };

    this.inboundMessageCounts.clear();
    this.inboundMessageBytes.clear();
    this.inboundMessageHandlerMs.clear();
    this.inboundAgentStreamCounts.clear();
    this.inboundAgentStreamByAgentCounts.clear();
    this.inboundBinaryFrameCounts.clear();
    return bucket;
  }

  private pruneBuckets(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.buckets.length > 0 && this.buckets[0].endedAt < cutoff) {
      this.buckets.shift();
    }
  }

  private aggregateBuckets(): RuntimeMetricsBucket {
    const aggregate = createEmptyBucket(Date.now());
    for (const bucket of this.buckets) {
      mergeCountMap(aggregate.inboundMessageCounts, bucket.inboundMessageCounts);
      mergeCountMap(aggregate.inboundMessageBytes, bucket.inboundMessageBytes);
      mergeHandlerTimingMap(aggregate.inboundMessageHandlerMs, bucket.inboundMessageHandlerMs);
      mergeCountMap(aggregate.inboundAgentStreamCounts, bucket.inboundAgentStreamCounts);
      mergeCountMap(
        aggregate.inboundAgentStreamByAgentCounts,
        bucket.inboundAgentStreamByAgentCounts,
      );
      mergeCountMap(aggregate.inboundBinaryFrameCounts, bucket.inboundBinaryFrameCounts);
    }
    return aggregate;
  }
}

function createEmptyBucket(endedAt: number): RuntimeMetricsBucket {
  return {
    inboundMessageCounts: new Map(),
    inboundMessageBytes: new Map(),
    inboundMessageHandlerMs: new Map(),
    inboundAgentStreamCounts: new Map(),
    inboundAgentStreamByAgentCounts: new Map(),
    inboundBinaryFrameCounts: new Map(),
    endedAt,
  };
}

function incrementCount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementHandlerTiming(
  map: Map<string, RuntimeMetricsHandlerTiming>,
  key: string,
  handlerMs: number,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += handlerMs;
    existing.maxMs = Math.max(existing.maxMs, handlerMs);
    return;
  }
  map.set(key, {
    count: 1,
    totalMs: handlerMs,
    maxMs: handlerMs,
  });
}

function cloneHandlerTimingMap(
  map: Map<string, RuntimeMetricsHandlerTiming>,
): Map<string, RuntimeMetricsHandlerTiming> {
  return new Map(
    [...map.entries()].map(([key, value]) => [
      key,
      { count: value.count, totalMs: value.totalMs, maxMs: value.maxMs },
    ]),
  );
}

function cloneInboundDispatchTiming(
  timing: DaemonClientInboundDispatchTiming,
): DaemonClientInboundDispatchTiming {
  return {
    at: timing.at,
    type: timing.type,
    agentId: timing.agentId,
    bytes: timing.bytes,
    decodeAndValidateMs: timing.decodeAndValidateMs,
    internalDispatchMs: timing.internalDispatchMs,
    rawListenersMs: timing.rawListenersMs,
    typedHandlersMs: timing.typedHandlersMs,
    totalMs: timing.totalMs,
  };
}

function mergeCountMap(target: Map<string, number>, source: Map<string, number>): void {
  for (const [key, value] of source) {
    incrementCount(target, key, value);
  }
}

function mergeHandlerTimingMap(
  target: Map<string, RuntimeMetricsHandlerTiming>,
  source: Map<string, RuntimeMetricsHandlerTiming>,
): void {
  for (const [key, value] of source) {
    const existing = target.get(key);
    if (existing) {
      existing.count += value.count;
      existing.totalMs += value.totalMs;
      existing.maxMs = Math.max(existing.maxMs, value.maxMs);
      continue;
    }
    target.set(key, {
      count: value.count,
      totalMs: value.totalMs,
      maxMs: value.maxMs,
    });
  }
}

function getTopCounts(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function getTopHandlerTimings(
  map: Map<string, RuntimeMetricsHandlerTiming>,
  limit: number,
): Array<{
  type: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}> {
  const rows = [...map.entries()].map(([type, value]) => ({
    type,
    count: value.count,
    totalMs: Math.round(value.totalMs),
    avgMs: Math.round((value.totalMs / value.count) * 100) / 100,
    maxMs: Math.round(value.maxMs * 100) / 100,
  }));
  rows.sort((a, b) => b.totalMs - a.totalMs);
  return rows.slice(0, limit);
}
