import type { Page } from "@playwright/test";

// Mirrors packages/app/src/diagnostics/resource-report — kept structural rather
// than imported so the spec compiles without pulling the app's module graph
// (and its `@/` alias + RN deps) into the Playwright process.

export interface SoakMetricTrend {
  key: string;
  samples: number;
  first: number;
  last: number;
  min: number;
  max: number;
  delta: number;
  slopePerHour: number;
  relativeGrowthPerHour: number;
  monotonicity: number;
}

export interface SoakTrendReport {
  samples: number;
  elapsedMs: number;
  growing: SoakMetricTrend[];
  all: SoakMetricTrend[];
}

export interface SoakSample {
  at: number;
  uptimeMs: number;
  metrics: Record<string, number>;
}

export interface SoakQueryHotspot {
  key: string;
  queries: number;
  observers: number;
}

interface ResourceMonitorBridge {
  sample: () => void;
  reset: () => void;
  samples: () => SoakSample[];
  trend: () => SoakTrendReport;
  hotspots: () => SoakQueryHotspot[];
  report: () => string;
}

type BridgeWindow = Window & { __ottoResourceMonitor?: ResourceMonitorBridge };

export async function waitForResourceMonitor(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as BridgeWindow).__ottoResourceMonitor !== "undefined",
    undefined,
    { timeout: timeoutMs },
  );
}

/** Drop history so the baseline is "app booted and idle", not "app starting up". */
export async function resetResourceMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as BridgeWindow).__ottoResourceMonitor?.reset();
  });
}

export async function takeResourceSample(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as BridgeWindow).__ottoResourceMonitor?.sample();
  });
}

export async function readResourceTrend(page: Page): Promise<SoakTrendReport> {
  return page.evaluate(() => {
    const bridge = (window as BridgeWindow).__ottoResourceMonitor;
    if (!bridge) {
      throw new Error("Resource monitor bridge is not installed");
    }
    return bridge.trend();
  });
}

export async function readResourceSamples(page: Page): Promise<SoakSample[]> {
  return page.evaluate(() => {
    const bridge = (window as BridgeWindow).__ottoResourceMonitor;
    if (!bridge) {
      throw new Error("Resource monitor bridge is not installed");
    }
    return bridge.samples();
  });
}

export async function readQueryHotspots(page: Page): Promise<SoakQueryHotspot[]> {
  return page.evaluate(() => {
    const bridge = (window as BridgeWindow).__ottoResourceMonitor;
    if (!bridge) {
      throw new Error("Resource monitor bridge is not installed");
    }
    return bridge.hotspots();
  });
}

export async function readResourceReport(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bridge = (window as BridgeWindow).__ottoResourceMonitor;
    if (!bridge) {
      throw new Error("Resource monitor bridge is not installed");
    }
    return bridge.report();
  });
}

/** Compact table for the console, so a soak run is readable without opening the JSON. */
export function formatTrendTable(trend: SoakTrendReport, limit = 20): string {
  const rows = trend.growing.slice(0, limit);
  if (rows.length === 0) {
    return "no monotonically growing metric";
  }
  const keyWidth = Math.max(...rows.map((row) => row.key.length));
  return rows
    .map((row) =>
      [
        row.key.padEnd(keyWidth),
        `${formatNumber(row.first)} -> ${formatNumber(row.last)}`.padEnd(24),
        `${formatNumber(row.slopePerHour)}/h`.padEnd(16),
        `mono=${(row.monotonicity * 100).toFixed(0)}%`,
      ].join("  "),
    )
    .join("\n");
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
