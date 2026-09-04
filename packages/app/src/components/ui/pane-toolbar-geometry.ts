/**
 * Compact action glyphs grow into thumb-sized controls. Keep a full spacing step between
 * their frames so adjacent glyphs retain visible separation; desktop preserves
 * the dense 1px toolbar rhythm.
 */
export function paneToolbarActionGap(compactGap: number) {
  return { xs: compactGap, sm: compactGap, md: 1, lg: 1, xl: 1 } as const;
}
