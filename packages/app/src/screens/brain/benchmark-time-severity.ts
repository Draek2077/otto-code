export type TimeSeverity = "success" | "warning" | "critical" | null;

/**
 * A comparison answers whether the same task became a performance outlier.
 * A result at least 5% faster than its matched task is green. A 1.5x
 * elapsed-time increase is amber and a 2x increase is red; values between
 * those extremes stay neutral.
 */
export function timeSeverity(seconds: number | null, comparedSeconds: number | null): TimeSeverity {
  if (seconds === null || comparedSeconds === null || seconds <= 0 || comparedSeconds <= 0) {
    return null;
  }
  if (seconds <= comparedSeconds * 0.95) {
    return "success";
  }
  if (seconds <= comparedSeconds) {
    return null;
  }
  const ratio = seconds / comparedSeconds;
  if (ratio >= 2) {
    return "critical";
  }
  return ratio >= 1.5 ? "warning" : null;
}
