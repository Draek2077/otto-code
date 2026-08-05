export type VisibilityScrollRestoration = "none" | "stick-to-bottom" | "restore-reader-position";

/**
 * Retained panels keep their chat mounted while invisible. Returning to one is
 * therefore not an unconditional bottom request: the app resumes following
 * output, while a reader who deliberately detached keeps their place.
 */
export function deriveVisibilityScrollRestoration(input: {
  wasVisible: boolean;
  isVisible: boolean;
  followsOutput: boolean;
}): VisibilityScrollRestoration {
  if (!input.isVisible || input.wasVisible) {
    return "none";
  }
  return input.followsOutput ? "stick-to-bottom" : "restore-reader-position";
}
