export interface BrowserRecord {
  browserId: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  faviconUrl: string | null;
  lastError: string | null;
  createdAt: number;
  /** True for tabs opened by the Preview button / preview_start's tab binding — rendered with a distinct icon so they read as "the preview", not a user-opened browser tab. */
  isPreview: boolean;
  /** The dev server this tab previews, when isPreview is true. Lets closing/stopping target the exact server instead of every browser tab. */
  previewServerId: string | null;
}

export type BrowserRecordPatch = Partial<Omit<BrowserRecord, "browserId" | "createdAt">>;

export interface BrowserIndexState {
  browsersById: Record<string, BrowserRecord>;
}

export function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeBrowserUrl(value: string | null | undefined): string {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) {
    return "https://example.com";
  }
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-fA-F:.]+])(?::\d+)?(?:[/?#]|$)/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function createBrowserRecord(input: {
  browserId: string;
  initialUrl: string | null | undefined;
  now: number;
  isPreview?: boolean;
  previewServerId?: string | null;
}): BrowserRecord {
  return {
    browserId: input.browserId,
    url: normalizeBrowserUrl(input.initialUrl),
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastError: null,
    createdAt: input.now,
    isPreview: input.isPreview ?? false,
    previewServerId: input.previewServerId ?? null,
  };
}

export function applyBrowserPatch<S extends BrowserIndexState>(
  state: S,
  browserId: string,
  patch: BrowserRecordPatch,
): S {
  const normalizedBrowserId = trimNonEmpty(browserId);
  if (!normalizedBrowserId) {
    return state;
  }
  const existing = state.browsersById[normalizedBrowserId];
  if (!existing) {
    return state;
  }

  const nextRecord: BrowserRecord = {
    ...existing,
    ...patch,
    url: normalizeBrowserUrl(patch.url ?? existing.url),
  };

  if (
    nextRecord.url === existing.url &&
    nextRecord.title === existing.title &&
    nextRecord.isLoading === existing.isLoading &&
    nextRecord.canGoBack === existing.canGoBack &&
    nextRecord.canGoForward === existing.canGoForward &&
    nextRecord.faviconUrl === existing.faviconUrl &&
    nextRecord.lastError === existing.lastError &&
    nextRecord.isPreview === existing.isPreview &&
    nextRecord.previewServerId === existing.previewServerId
  ) {
    return state;
  }

  return {
    ...state,
    browsersById: {
      ...state.browsersById,
      [normalizedBrowserId]: nextRecord,
    },
  };
}

export function removeBrowserFromIndex<S extends BrowserIndexState>(
  state: S,
  browserId: string,
): S {
  const normalizedBrowserId = trimNonEmpty(browserId);
  if (!normalizedBrowserId) {
    return state;
  }
  if (!state.browsersById[normalizedBrowserId]) {
    return state;
  }
  const next = { ...state.browsersById };
  delete next[normalizedBrowserId];
  return { ...state, browsersById: next };
}

export function sanitizeBrowsersForPersist(state: BrowserIndexState): {
  browsersById: Record<string, BrowserRecord>;
} {
  return {
    browsersById: Object.fromEntries(
      Object.entries(state.browsersById).map(([browserId, browser]) => [
        browserId,
        { ...browser, isLoading: false, lastError: null },
      ]),
    ),
  };
}
