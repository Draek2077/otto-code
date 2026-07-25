// Boots the resource monitor as early as the app bundle allows.
//
// Imported for its side effect from `app/_layout.tsx`, above the React tree, so
// the timer patch lands before feature code starts scheduling and the census has
// a real zero point. Degradation that only shows after an hour is not something
// you can go back and start measuring once someone notices.

import { analyzeResourceTrend } from "./resource-trend";
import {
  collectQueryHotspots,
  collectTrafficHotspots,
  type QueryHotspot,
  type TrafficHotspot,
} from "./collect-resource-metrics";
import { resourceMonitor } from "./resource-monitor";
import { formatResourceReport } from "./format-resource-report";

export function startResourceMonitor(): void {
  resourceMonitor.start();
}

/** The `Client resources` section of the app diagnostic report. */
export function collectResourceDiagnosticSection(): string {
  const samples = resourceMonitor.getSamples();
  return formatResourceReport({
    samples,
    trend: analyzeResourceTrend(samples),
    sampleIntervalMs: resourceMonitor.getSampleIntervalMs(),
    queryHotspots: collectQueryHotspots(),
    trafficHotspots: collectTrafficHotspots(),
  });
}

interface ResourceMonitorBridge {
  sample: () => void;
  reset: () => void;
  samples: () => Array<{ at: number; uptimeMs: number; metrics: Record<string, number> }>;
  trend: () => ReturnType<typeof analyzeResourceTrend>;
  hotspots: () => QueryHotspot[];
  traffic: () => TrafficHotspot[];
  report: () => string;
}

/**
 * Test bridge. The Playwright soak spec drives a long session and reads the
 * series back out of the page; without this it would have to infer retention
 * from screenshots.
 */
export function installResourceMonitorBridge(): void {
  if (typeof globalThis === "undefined") {
    return;
  }
  const bridge: ResourceMonitorBridge = {
    sample: () => {
      resourceMonitor.takeSample();
    },
    reset: () => {
      resourceMonitor.reset();
    },
    samples: () =>
      resourceMonitor.getSamples().map((sample) => ({
        at: sample.at,
        uptimeMs: sample.uptimeMs,
        metrics: { ...sample.metrics },
      })),
    trend: () => analyzeResourceTrend(resourceMonitor.getSamples()),
    hotspots: () => collectQueryHotspots(24),
    traffic: () => collectTrafficHotspots(24),
    report: () => collectResourceDiagnosticSection(),
  };
  (globalThis as { __ottoResourceMonitor?: ResourceMonitorBridge }).__ottoResourceMonitor = bridge;
}
