/** Formatting helpers shared by the renderer and the tests. No DOM in this module. */

export type Trend = "up" | "down" | "flat";

export interface Metric {
  readonly id: string;
  readonly label: string;
  readonly samples: readonly number[];
  readonly unit: string;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
}

/**
 * Compares the last sample against the mean of the ones before it. A single
 * sample has nothing to compare against, so it is flat by definition rather
 * than by accident.
 */
export function trendOf(values: readonly number[], tolerance = 0.02): Trend {
  if (values.length < 2) {
    return "flat";
  }
  const latest = values[values.length - 1]!;
  const baseline = mean(values.slice(0, -1));
  if (baseline === 0) {
    return latest === 0 ? "flat" : "up";
  }
  const delta = (latest - baseline) / baseline;
  if (Math.abs(delta) <= tolerance) {
    return "flat";
  }
  return delta > 0 ? "up" : "down";
}

export function formatNumber(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded.toLocaleString("en-US")}${unit}`;
}

export function percentChange(values: readonly number[]): string {
  if (values.length < 2) {
    return "—";
  }
  const baseline = mean(values.slice(0, -1));
  if (baseline === 0) {
    return "—";
  }
  const delta = ((values[values.length - 1]! - baseline) / baseline) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}
