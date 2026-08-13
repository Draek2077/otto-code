/** The renderer actually mounted for a review surface. */
export type DiffRenderer = "legacy" | "new";

/**
 * New rendering is opt-in at the surface and must be supported by this file.
 * Unsupported input deliberately stays on the established renderer; a caller
 * must never try to emulate a structural result from incomplete capabilities.
 */
export function selectDiffRenderer(input: {
  isNewDiffEnabled: boolean;
  isNewDiffCapable: boolean;
}): DiffRenderer {
  return input.isNewDiffEnabled && input.isNewDiffCapable ? "new" : "legacy";
}
