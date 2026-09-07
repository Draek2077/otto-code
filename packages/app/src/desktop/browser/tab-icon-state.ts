export type BrowserTabIconKind = "favicon" | "globe" | "preview";

export function getBrowserTabLoadingStatus(isLoading: boolean): "running" | null {
  return isLoading ? "running" : null;
}

/**
 * A page-provided favicon is optional decoration. The tab's Globe is its
 * identity, so a failed image request must return to that glyph rather than
 * leaving an empty icon slot.
 */
export function getBrowserTabIconKind(input: {
  faviconUrl: string | null;
  faviconFailed: boolean;
  isPreview: boolean;
}): BrowserTabIconKind {
  if (input.isPreview) {
    return "preview";
  }
  return input.faviconUrl && !input.faviconFailed ? "favicon" : "globe";
}
