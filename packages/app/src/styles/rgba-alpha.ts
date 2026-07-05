// Re-derives an rgba() string at a different alpha. Used to boost a theme's
// diff background tint (e.g. for intraline highlight emphasis) without every
// syntax theme needing to author a second color for the same hue.
export function withAlpha(rgbaColor: string, alpha: number): string {
  const match = rgbaColor.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),/);
  if (!match) return rgbaColor;
  const [, r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
