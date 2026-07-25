// Renders the monitor's history as the `label: value` diagnostic text the rest
// of `diagnostics/` produces, so the resource section can be pasted into a bug
// report alongside the app and daemon sections.

import { formatDiagnosticSection } from "@/diagnostics/app-diagnostic-report";
import type { QueryHotspot, TrafficHotspot } from "./collect-resource-metrics";
import type { MetricTrend, ResourceSample, ResourceTrendReport } from "./resource-trend";

const FRAME_METRIC_KEYS = [
  "frames.fps",
  "frames.meanFrameMs",
  "frames.p95FrameMs",
  "frames.worstFrameMs",
  "frames.longFrames",
  "frames.jankRatio",
  "frames.stalls",
] as const;

const HEADLINE_METRIC_KEYS = [
  "heap.usedBytes",
  "dom.nodes",
  "query.queries",
  "query.unobserved",
  "runtime.liveIntervals",
  "runtime.pendingTimeouts",
  "traffic.messages",
  "traffic.bytes",
  "traffic.handlerMs",
] as const;

export function formatResourceReport(input: {
  samples: readonly ResourceSample[];
  trend: ResourceTrendReport;
  sampleIntervalMs: number;
  queryHotspots?: readonly QueryHotspot[];
  trafficHotspots?: readonly TrafficHotspot[];
}): string {
  const { samples, trend, sampleIntervalMs } = input;
  if (samples.length === 0) {
    return formatDiagnosticSection("Client resources", [
      { label: "Status", value: "monitor has taken no samples yet" },
    ]);
  }

  const latest = samples[samples.length - 1];
  const sections = [
    formatDiagnosticSection("Client resources", [
      { label: "Observed for", value: formatDurationMs(trend.elapsedMs) },
      { label: "Samples", value: `${samples.length} at ${Math.round(sampleIntervalMs / 1000)}s` },
      ...HEADLINE_METRIC_KEYS.map((key) => ({
        label: key,
        value: formatMetricWithDelta(key, latest, trend),
      })),
    ]),
    formatDiagnosticSection(
      "Client frame timing (last window)",
      FRAME_METRIC_KEYS.map((key) => ({
        label: key,
        value: formatValue(key, latest.metrics[key]),
      })),
    ),
    formatFpsDriftSection(samples),
    formatGrowthSection(trend),
    formatTrafficSection(samples, input.trafficHotspots ?? []),
    formatQueryHotspotSection(input.queryHotspots ?? []),
  ];

  return sections.join("\n\n");
}

/**
 * How much of the app's life has gone into handling daemon messages. `share of
 * session` is the number to read: it converts a raw handler-ms total into "this
 * fraction of the wall clock was the UI thread busy applying daemon traffic",
 * which is what decides whether a chatty connection is actually the problem.
 */
function formatTrafficSection(
  samples: readonly ResourceSample[],
  hotspots: readonly TrafficHotspot[],
): string {
  const latest = samples[samples.length - 1];
  const handlerMs = latest.metrics["traffic.handlerMs"];
  const messages = latest.metrics["traffic.messages"];
  if (typeof handlerMs !== "number" || typeof messages !== "number") {
    return formatDiagnosticSection("Daemon traffic", [
      { label: "Status", value: "no connected host reported traffic" },
    ]);
  }

  const elapsedMs = latest.uptimeMs;
  const entries = [
    { label: "Messages", value: String(messages) },
    { label: "Bytes", value: formatBytes(latest.metrics["traffic.bytes"] ?? 0) },
    { label: "Binary frames", value: String(latest.metrics["traffic.binaryFrames"] ?? 0) },
    { label: "Handler time", value: `${(handlerMs / 1000).toFixed(2)}s` },
    {
      label: "Share of session",
      value: elapsedMs > 0 ? `${((handlerMs / elapsedMs) * 100).toFixed(2)}%` : "unknown",
    },
    {
      label: "Mean per message",
      value: messages > 0 ? `${(handlerMs / messages).toFixed(3)}ms` : "unknown",
    },
  ];

  const hotspotEntries = hotspots.map((hotspot) => ({
    label: hotspot.type,
    value: `${hotspot.count} msgs, ${hotspot.totalMs.toFixed(0)}ms total, ${hotspot.maxMs.toFixed(
      1,
    )}ms worst, ${formatBytes(hotspot.bytes)}`,
  }));

  return formatDiagnosticSection("Daemon traffic (inbound, session totals)", [
    ...entries,
    ...hotspotEntries,
  ]);
}

function formatQueryHotspotSection(hotspots: readonly QueryHotspot[]): string {
  if (hotspots.length === 0) {
    return formatDiagnosticSection("Query cache hotspots", [
      { label: "Status", value: "no cached queries" },
    ]);
  }
  return formatDiagnosticSection(
    "Query cache hotspots (by live observers)",
    hotspots.map((hotspot) => ({
      label: hotspot.key,
      value: `${hotspot.observers} observers across ${hotspot.queries} queries`,
    })),
  );
}

/**
 * The headline comparison for the reported symptom: frame timing in the first
 * tenth of the session versus the last. A leak shows up here as the two halves
 * diverging while nothing else in the session changed.
 */
function formatFpsDriftSection(samples: readonly ResourceSample[]): string {
  const withFrames = samples.filter(
    (sample) =>
      typeof sample.metrics["frames.counted"] === "number" && sample.metrics["frames.counted"] > 0,
  );
  if (withFrames.length < 4) {
    return formatDiagnosticSection("Client frame drift", [
      { label: "Status", value: "not enough frame samples" },
    ]);
  }

  const bucket = Math.max(1, Math.floor(withFrames.length / 10));
  const head = withFrames.slice(0, bucket);
  const tail = withFrames.slice(-bucket);
  const headFps = mean(head.map((sample) => sample.metrics["frames.fps"] ?? 0));
  const tailFps = mean(tail.map((sample) => sample.metrics["frames.fps"] ?? 0));
  const headP95 = mean(head.map((sample) => sample.metrics["frames.p95FrameMs"] ?? 0));
  const tailP95 = mean(tail.map((sample) => sample.metrics["frames.p95FrameMs"] ?? 0));

  return formatDiagnosticSection("Client frame drift (first vs last decile)", [
    { label: "fps", value: `${headFps.toFixed(1)} → ${tailFps.toFixed(1)}` },
    { label: "p95 frame", value: `${headP95.toFixed(1)}ms → ${tailP95.toFixed(1)}ms` },
    {
      label: "Verdict",
      value:
        tailFps < headFps * 0.9
          ? "frame rate degraded over the session"
          : "no frame-rate degradation observed",
    },
  ]);
}

function formatGrowthSection(trend: ResourceTrendReport): string {
  if (trend.growing.length === 0) {
    return formatDiagnosticSection("Client growth ranking", [
      {
        label: "Status",
        value:
          trend.samples < 4 ? "not enough samples to fit a trend" : "no metric grew monotonically",
      },
    ]);
  }

  return formatDiagnosticSection(
    "Client growth ranking (monotonic climbers, worst first)",
    trend.growing.map((metric) => ({
      label: metric.key,
      value: formatTrend(metric),
    })),
  );
}

function formatTrend(metric: MetricTrend): string {
  return [
    `${formatValue(metric.key, metric.first)} → ${formatValue(metric.key, metric.last)}`,
    `+${formatValue(metric.key, metric.slopePerHour)}/h`,
    `x${(1 + metric.relativeGrowthPerHour).toFixed(2)}/h`,
    `monotonic=${(metric.monotonicity * 100).toFixed(0)}%`,
  ].join(", ");
}

function formatMetricWithDelta(
  key: string,
  latest: ResourceSample,
  trend: ResourceTrendReport,
): string {
  const value = latest.metrics[key];
  const metric = trend.all.find((candidate) => candidate.key === key);
  if (!metric) {
    return formatValue(key, value);
  }
  return `${formatValue(key, metric.first)} → ${formatValue(key, metric.last)} (+${formatValue(
    key,
    metric.slopePerHour,
  )}/h)`;
}

function formatValue(key: string, value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "unknown";
  }
  if (key.endsWith("Bytes")) {
    return formatBytes(value);
  }
  if (key.endsWith("Ms")) {
    return `${value.toFixed(1)}ms`;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  const units = ["B", "KiB", "MiB", "GiB"];
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${sign}${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDurationMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
