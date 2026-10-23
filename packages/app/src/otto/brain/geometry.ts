/** Frozen artwork overflows its layout box uniformly across every glyph variant. */
export const BRAIN_GLYPH_SCALE = 1.1;
export function brainGlyphExtent(size: number): number {
  return size * BRAIN_GLYPH_SCALE;
}
