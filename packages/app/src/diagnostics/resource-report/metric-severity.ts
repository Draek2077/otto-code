export type MetricSeverity = "normal" | "warning" | "danger";

export interface MetricThresholds {
  warning: number;
  danger: number;
  direction?: "high" | "low";
}

export function metricSeverity(
  key: string,
  value: number | undefined,
  heapLimitBytes?: number,
): MetricSeverity {
  if (typeof value !== "number" || !Number.isFinite(value)) return "normal";

  const thresholds = thresholdsFor(key, heapLimitBytes);
  if (!thresholds) return "normal";

  if (thresholds.direction === "low") {
    if (value <= thresholds.danger) return "danger";
    if (value <= thresholds.warning) return "warning";
    return "normal";
  }
  if (value >= thresholds.danger) return "danger";
  if (value >= thresholds.warning) return "warning";
  return "normal";
}

function thresholdsFor(key: string, heapLimitBytes?: number): MetricThresholds | null {
  if (key === "heap.usedBytes" && heapLimitBytes && heapLimitBytes > 0) {
    return { warning: heapLimitBytes * 0.7, danger: heapLimitBytes * 0.85 };
  }

  // Defaults are deliberately conservative and only apply to instantaneous
  // readings. Cumulative traffic counters are not warnings: their magnitude is
  // a function of session age, not current resource pressure.
  const defaults: Record<string, MetricThresholds> = {
    "frames.fps": { warning: 45, danger: 30, direction: "low" },
    "frames.p95FrameMs": { warning: 32, danger: 50 },
    "frames.worstFrameMs": { warning: 100, danger: 250 },
    "frames.longFrames": { warning: 2, danger: 10 },
    "dom.nodes": { warning: 100_000, danger: 250_000 },
    "query.queries": { warning: 500, danger: 1_500 },
    "query.unobserved": { warning: 100, danger: 500 },
    "query.observers": { warning: 200, danger: 1_000 },
    "runtime.liveIntervals": { warning: 100, danger: 300 },
    "runtime.pendingTimeouts": { warning: 100, danger: 500 },
    "traffic.messagesPerSecond": { warning: 100, danger: 500 },
    "traffic.bytesPerSecond": { warning: 1_000_000, danger: 5_000_000 },
    "traffic.handlerMsPerSecond": { warning: 100, danger: 250 },
    "chat.streams": { warning: 8, danger: 12 },
    "chat.agents": { warning: 10, danger: 25 },
    "chat.chats": { warning: 6, danger: 12 },
    "chat.workspaces": { warning: 5, danger: 10 },
  };
  return defaults[key] ?? null;
}
