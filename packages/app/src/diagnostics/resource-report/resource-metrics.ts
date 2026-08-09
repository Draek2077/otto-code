// Shapes the collected readings into the flat metric record the trend analyzer
// consumes. Pure, so the metric namespace is pinned by tests rather than by
// whatever the browser happened to report.

import type { FrameWindowStats } from "./frame-rate-sampler";
import type { RuntimeCounters } from "./runtime-counters";

export interface QueryCacheReading {
  queries: number;
  unobservedQueries: number;
  queriesWithData: number;
  observers: number;
  mutations: number;
}

export interface DomReading {
  nodes: number;
  iframes: number;
  webviews: number;
  canvases: number;
  styleSheets: number;
}

export interface HeapReading {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
}

export interface TrafficReading {
  messages: number;
  bytes: number;
  /** Cumulative main-thread ms spent handling inbound daemon messages. */
  handlerMs: number;
  binaryFrames: number;
  connectedHosts: number;
  messagesPerSecond: number;
  bytesPerSecond: number;
  handlerMsPerSecond: number;
}

export interface ChatStateReading {
  /** Agent stream buffers currently retained by the client, one per agent. */
  streams: number;
  /** Non-archived agent sessions whose lifecycle has not closed. */
  agents: number;
  /** Chat tabs currently present in the workspace layouts. */
  chats: number;
  /** Workspace descriptors currently retained by connected sessions. */
  workspaces: number;
}

export interface ResourceMetricsInput {
  /** Output of the container census, already prefixed per store. */
  stores: Readonly<Record<string, number>>;
  query: QueryCacheReading | null;
  dom: DomReading | null;
  heap: HeapReading | null;
  runtime: RuntimeCounters;
  traffic: TrafficReading | null;
  chat: ChatStateReading;
  frames: FrameWindowStats | null;
}

export function buildResourceMetrics(
  input: ResourceMetricsInput,
): Readonly<Record<string, number>> {
  const metrics: Record<string, number> = {};

  for (const [key, value] of Object.entries(input.stores)) {
    if (Number.isFinite(value)) {
      metrics[`store.${key}`] = value;
    }
  }

  if (input.query) {
    metrics["query.queries"] = input.query.queries;
    metrics["query.unobserved"] = input.query.unobservedQueries;
    metrics["query.withData"] = input.query.queriesWithData;
    metrics["query.observers"] = input.query.observers;
    metrics["query.mutations"] = input.query.mutations;
  }

  if (input.dom) {
    metrics["dom.nodes"] = input.dom.nodes;
    metrics["dom.iframes"] = input.dom.iframes;
    metrics["dom.webviews"] = input.dom.webviews;
    metrics["dom.canvases"] = input.dom.canvases;
    metrics["dom.styleSheets"] = input.dom.styleSheets;
  }

  if (input.heap) {
    metrics["heap.usedBytes"] = input.heap.usedBytes;
    metrics["heap.totalBytes"] = input.heap.totalBytes;
    metrics["heap.limitBytes"] = input.heap.limitBytes;
  }

  metrics["runtime.liveIntervals"] = input.runtime.liveIntervals;
  metrics["runtime.pendingTimeouts"] = input.runtime.pendingTimeouts;
  metrics["runtime.intervalsCreated"] = input.runtime.intervalsCreated;
  metrics["runtime.timeoutsCreated"] = input.runtime.timeoutsCreated;

  if (input.traffic) {
    metrics["traffic.messages"] = input.traffic.messages;
    metrics["traffic.bytes"] = input.traffic.bytes;
    metrics["traffic.handlerMs"] = round(input.traffic.handlerMs, 1);
    metrics["traffic.messagesPerSecond"] = round(input.traffic.messagesPerSecond, 2);
    metrics["traffic.bytesPerSecond"] = round(input.traffic.bytesPerSecond, 2);
    metrics["traffic.handlerMsPerSecond"] = round(input.traffic.handlerMsPerSecond, 2);
    metrics["traffic.binaryFrames"] = input.traffic.binaryFrames;
    metrics["traffic.connectedHosts"] = input.traffic.connectedHosts;
  }

  metrics["chat.streams"] = input.chat.streams;
  metrics["chat.agents"] = input.chat.agents;
  metrics["chat.chats"] = input.chat.chats;
  metrics["chat.workspaces"] = input.chat.workspaces;

  if (input.frames) {
    metrics["frames.fps"] = round(input.frames.fps, 2);
    metrics["frames.meanFrameMs"] = round(input.frames.meanFrameMs, 2);
    metrics["frames.p95FrameMs"] = round(input.frames.p95FrameMs, 2);
    metrics["frames.worstFrameMs"] = round(input.frames.worstFrameMs, 2);
    metrics["frames.slowFrames"] = input.frames.slowFrames;
    metrics["frames.longFrames"] = input.frames.longFrames;
    metrics["frames.jankRatio"] = round(input.frames.jankRatio, 4);
    metrics["frames.counted"] = input.frames.frames;
    metrics["frames.stalls"] = input.frames.stalls;
  }

  return metrics;
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
