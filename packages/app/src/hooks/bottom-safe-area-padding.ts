/**
 * Preserves a surface's authored bottom rhythm, then clears exactly the system
 * obstruction. Safe-area context reports zero where there is no obstruction,
 * so desktop and square Android navigation remain visually unchanged.
 */
export function resolveBottomSafeAreaPadding(input: {
  basePadding: number;
  safeAreaBottom: number;
}): number {
  return input.basePadding + Math.max(0, input.safeAreaBottom);
}
