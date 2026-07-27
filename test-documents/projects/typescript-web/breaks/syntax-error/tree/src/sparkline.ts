import type { Metric } from "./format.ts";

export interface SparklineOptions {
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
}

/**
 * Builds an SVG polyline path for a metric's samples. Returned as a string rather
 * than DOM nodes so it can be unit tested and server-rendered — the browser half
 * only ever sets innerHTML.
 */
export function sparklinePoints(
  samples: readonly number[],
  options: SparklineOptions = {},
): string {
  const width = options.width ?? 240;
  const height = options.height ?? 48;
  const padding = options.padding ?? 4;

  if (samples.length === 0) {
    return "";
  }
  if (samples.length === 1) {
    const middle = height / 2;
    return `${padding},${middle} ${width - padding},${middle};
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  // A flat series has no range to scale into; pin it to the middle instead of
  // dividing by zero and producing NaN coordinates.
  const range = max - min || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  return samples
    .map((sample, index) => {
      const x = padding + (index / (samples.length - 1)) * usableWidth;
      const y = padding + usableHeight - ((sample - min) / range) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function sparklineSvg(metric: Metric, options: SparklineOptions = {}): string {
  const width = options.width ?? 240;
  const height = options.height ?? 48;
  const points = sparklinePoints(metric.samples, options);
  return [
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric.label} trend">`,
    `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" `,
    `stroke-linecap="round" stroke-linejoin="round" /></svg>`,
  ].join("");
}
