// Trend analysis over a series of resource samples.
//
// A single snapshot cannot find a leak - "3,412 cached queries" is only alarming
// once you know it was 180 an hour ago. This module turns the monitor's ring
// buffer into a ranked answer to "what is growing?", which is the whole point of
// the instrument: it names the suspect instead of leaving you to guess.
//
// Ranking is by *relative growth per hour* rather than raw slope so that metrics
// with wildly different units (bytes, counts, ratios) compare sensibly, and it is
// gated on monotonicity so a metric that merely oscillates (open tab count,
// in-flight requests) does not outrank one that only ever climbs.

export interface ResourceSample {
  /** Epoch ms. */
  at: number;
  /** Ms since the monitor started - the regression's x axis. */
  uptimeMs: number;
  metrics: Readonly<Record<string, number>>;
}

export interface MetricTrend {
  key: string;
  samples: number;
  first: number;
  last: number;
  min: number;
  max: number;
  delta: number;
  /** Least-squares slope in units per hour. */
  slopePerHour: number;
  /** slopePerHour / max(|first|, 1) - dimensionless, comparable across metrics. */
  relativeGrowthPerHour: number;
  /**
   * Fraction of consecutive steps that did not decrease. 1 means the metric only
   * ever climbed - the signature of something never released.
   */
  monotonicity: number;
}

export interface ResourceTrendReport {
  samples: number;
  elapsedMs: number;
  /** Monotonic climbers, worst first - the leak candidates. */
  growing: MetricTrend[];
  /** Every metric, for the full table. */
  all: MetricTrend[];
}

export interface AnalyzeResourceTrendOptions {
  /** Below this, a series is too short to draw a line through. */
  minSamples?: number;
  /** A metric must not decrease on at least this fraction of steps to count as growing. */
  minMonotonicity?: number;
  /** A metric must climb by at least this fraction of its starting value. */
  minRelativeGrowth?: number;
  /** Cap on the `growing` list. */
  limit?: number;
}

const DEFAULT_MIN_SAMPLES = 4;
const DEFAULT_MIN_MONOTONICITY = 0.8;
const DEFAULT_MIN_RELATIVE_GROWTH = 0.05;
const DEFAULT_LIMIT = 25;

export function analyzeResourceTrend(
  samples: readonly ResourceSample[],
  options: AnalyzeResourceTrendOptions = {},
): ResourceTrendReport {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const minMonotonicity = options.minMonotonicity ?? DEFAULT_MIN_MONOTONICITY;
  const minRelativeGrowth = options.minRelativeGrowth ?? DEFAULT_MIN_RELATIVE_GROWTH;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const elapsedMs =
    samples.length > 0 ? samples[samples.length - 1].uptimeMs - samples[0].uptimeMs : 0;

  if (samples.length < minSamples) {
    return { samples: samples.length, elapsedMs, growing: [], all: [] };
  }

  const all: MetricTrend[] = [];
  for (const key of collectMetricKeys(samples)) {
    const trend = buildMetricTrend(key, samples);
    if (trend) {
      all.push(trend);
    }
  }

  all.sort((left, right) => right.relativeGrowthPerHour - left.relativeGrowthPerHour);

  const growing = all
    .filter(
      (trend) =>
        trend.delta > 0 &&
        trend.monotonicity >= minMonotonicity &&
        trend.delta / Math.max(Math.abs(trend.first), 1) >= minRelativeGrowth,
    )
    .slice(0, limit);

  return { samples: samples.length, elapsedMs, growing, all };
}

function collectMetricKeys(samples: readonly ResourceSample[]): string[] {
  const keys = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample.metrics)) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

function buildMetricTrend(key: string, samples: readonly ResourceSample[]): MetricTrend | null {
  const points: Array<{ hours: number; value: number }> = [];
  for (const sample of samples) {
    const value = sample.metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      points.push({ hours: sample.uptimeMs / 3_600_000, value });
    }
  }
  if (points.length < 2) {
    return null;
  }

  const values = points.map((point) => point.value);
  const first = values[0];
  const last = values[values.length - 1];

  let nonDecreasingSteps = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] >= values[index - 1]) {
      nonDecreasingSteps += 1;
    }
  }

  const slopePerHour = leastSquaresSlope(points);

  return {
    key,
    samples: points.length,
    first,
    last,
    min: Math.min(...values),
    max: Math.max(...values),
    delta: last - first,
    slopePerHour,
    relativeGrowthPerHour: slopePerHour / Math.max(Math.abs(first), 1),
    monotonicity: nonDecreasingSteps / (values.length - 1),
  };
}

function leastSquaresSlope(points: Array<{ hours: number; value: number }>): number {
  const count = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.hours;
    sumY += point.value;
  }
  const meanX = sumX / count;
  const meanY = sumY / count;

  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.hours - meanX;
    covariance += dx * (point.value - meanY);
    variance += dx * dx;
  }

  // All samples landed in the same instant - no line to fit.
  return variance === 0 ? 0 : covariance / variance;
}
