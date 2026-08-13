import type { Theme } from "@/styles/theme";

/**
 * Compute the pixel width for a line-number gutter based on the highest
 * line number that will be displayed and the gutter font size. Callers can
 * choose their minimum digit count: editors reserve two digits to avoid
 * reflow, while a compact diff gutter may reserve just one. The 0.62 factor
 * approximates monospace digit width as a fraction of font size.
 */
export function lineNumberGutterWidth(
  maxLineNumber: number,
  fontSize: number,
  horizontalPadding = 12,
  minimumDigits = 2,
): number {
  const digits = Math.max(minimumDigits, String(maxLineNumber).length);
  const digitWidth = Math.ceil(fontSize * 0.62);
  return digits * digitWidth + horizontalPadding;
}

/** Width for a two-coordinate unified-review gutter. */
export function pairedDiffLineNumberGutterWidth(maxLineNumber: number, fontSize: number): number {
  const cellWidth = lineNumberGutterWidth(maxLineNumber, fontSize, 0, 1);
  return cellWidth * 2 + 18;
}

export function getCodeInsets(theme: Theme) {
  let padding: number;
  if (typeof theme.spacing?.[3] === "number") padding = theme.spacing[3];
  else if (typeof theme.spacing?.[4] === "number") padding = theme.spacing[4];
  else padding = 12;
  const extraRight = theme.spacing[4];
  const extraBottom = theme.spacing[3];

  return { padding, extraRight, extraBottom };
}
