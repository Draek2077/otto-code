export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

/**
 * Same shortening as {@link formatTokenCount}, but with a decimal slot so a
 * counter that updates while a turn streams keeps visibly moving. Whole-`k`
 * rounding sits still for a thousand tokens at a time, which reads as a stalled
 * turn. The zeros are never trimmed ("1.0k", not "1k") so the label keeps a
 * stable width instead of jittering as digits come and go.
 */
export function formatLiveTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return Math.round(value).toString();
}
