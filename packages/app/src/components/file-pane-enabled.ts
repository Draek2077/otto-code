/**
 * Whether `FilePane` should read its file right now.
 *
 * The read is gated on visibility so a revisited tab refetches instead of showing
 * the frozen first-load snapshot (#445): React Query refetches on the
 * disabled→enabled transition (stale-gated by the query's staleTime). The file is
 * read only when there is something to read AND the pane can actually show it —
 * the tab is the active one (not a hidden, mounted-but-offscreen tab) and the
 * whole app is in the foreground.
 */
export function isFileQueryEnabled(input: {
  hasReadTarget: boolean;
  isTabActive: boolean;
  isAppVisible: boolean;
}): boolean {
  return input.hasReadTarget && input.isTabActive && input.isAppVisible;
}

/** What the preview body should show, given where the read has got to. */
export type FilePreviewState = "loading" | "unavailable" | "ready";

/**
 * The other half of the gate above: because the read is gated, "not started yet" and "finished
 * with nothing to show" are different states that React Query reports identically — a disabled
 * query has `isFetching: false` and no data, exactly like a completed one that returned nothing.
 * Keying the empty state off the fetch flag therefore flashes "No preview available" every time
 * a tab activates or the app returns to the foreground, before the read has even been issued.
 *
 * So `unavailable` requires the read to have actually resolved. The only state that outranks
 * loading is having nothing to read at all — a disconnected host never resolves, and spinning
 * forever would be its own lie.
 */
export function resolveFilePreviewState(input: {
  hasReadTarget: boolean;
  /** True until the query has data — covers both "disabled" and "in flight". */
  isPending: boolean;
  hasPreview: boolean;
}): FilePreviewState {
  if (input.hasPreview) {
    return "ready";
  }
  if (!input.hasReadTarget) {
    return "unavailable";
  }
  return input.isPending ? "loading" : "unavailable";
}
