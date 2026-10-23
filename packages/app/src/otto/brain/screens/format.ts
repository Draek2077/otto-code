const GIB = 1024 ** 3;

export function formatGiB(bytes: number | null | undefined, digits = 1): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return "unknown";
  }
  return `${(bytes / GIB).toFixed(digits)} GB`;
}

export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "unknown";
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    return "unknown";
  }
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A benchmark score as the TUI shows it: a whole percentage, or an em space. */
export function formatScore(overall: number | null | undefined): string {
  return typeof overall === "number" && Number.isFinite(overall)
    ? `${Math.round(overall * 100)}%`
    : "–";
}

/**
 * The colour band for a benchmark score, matching the TUI's four thresholds
 * (`scoreColour()`) so a model that read as "good" in the terminal reads the
 * same here: >=0.75 good, >=0.55 fair, >=0.35 poor, else bad.
 */
export function scoreBand(
  overall: number | null | undefined,
): "good" | "fair" | "poor" | "bad" | "none" {
  if (typeof overall !== "number" || !Number.isFinite(overall)) {
    return "none";
  }
  if (overall >= 0.75) {
    return "good";
  }
  if (overall >= 0.55) {
    return "fair";
  }
  if (overall >= 0.35) {
    return "poor";
  }
  return "bad";
}

/**
 * How the calibration state reads in the UI. `inherited` is deliberately not
 * called "measured": it came from a relative with the same attention geometry,
 * rescaled to this model's layer count.
 */
export function calibrationLabel(state: string | null | undefined): string {
  switch (state) {
    case "measured":
      return "Measured";
    case "inherited":
      return "Measured on a relative";
    case "stale":
      return "Previous measurement, recalibrate for this setting";
    case "theoretical":
      return "Estimated";
    default:
      return "Unknown";
  }
}
