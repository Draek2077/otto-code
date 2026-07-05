/** Lifecycle of a preview tab's dev server within this app session. Always renormalized to "idle" (or "ready" for non-preview tabs) before writing to storage and again on rehydration, so a restored tab is re-verified rather than trusted. */
export type PreviewStatus = "idle" | "starting" | "ready" | "error" | "needs-start";

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
  /** launch.json configuration name, captured at creation time so the server can be restarted after an app restart invalidates previewServerId. */
  previewServerName: string | null;
  /** cwd the dev server was launched from, captured at creation time for the same reason. */
  previewCwd: string | null;
  /** Meaningless for non-preview tabs (always "ready" there). */
  previewStatus: PreviewStatus;
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
  previewServerName?: string | null;
  previewCwd?: string | null;
  previewStatus?: PreviewStatus;
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
    previewServerName: input.previewServerName ?? null,
    previewCwd: input.previewCwd ?? null,
    previewStatus: input.previewStatus ?? (input.isPreview ? "starting" : "ready"),
  };
}

/**
 * Normalizes a rehydrated (persisted) record, including ones written before
 * previewServerName/previewCwd/previewStatus existed — those come back as
 * `undefined`, which matches none of PreviewStatus's variants, so without this
 * an old preview tab would render a permanently blank overlay (the bootstrap
 * and ready-navigate effects only match "idle"/"ready" respectively).
 */
export function rehydrateBrowserRecord(
  browserId: string,
  raw: Partial<BrowserRecord> | undefined,
): BrowserRecord {
  return createBrowserRecord({
    browserId,
    initialUrl: raw?.url,
    now: raw?.createdAt ?? Date.now(),
    isPreview: raw?.isPreview,
    previewServerId: raw?.previewServerId,
    previewServerName: raw?.previewServerName,
    previewCwd: raw?.previewCwd,
    previewStatus: raw?.isPreview ? "idle" : "ready",
  });
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
    nextRecord.previewServerId === existing.previewServerId &&
    nextRecord.previewServerName === existing.previewServerName &&
    nextRecord.previewCwd === existing.previewCwd &&
    nextRecord.previewStatus === existing.previewStatus
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
        {
          ...browser,
          isLoading: false,
          lastError: null,
          // Never trust a persisted "ready"/"error"/etc — the process behind it
          // may be gone by the time this is rehydrated. Re-verify from scratch.
          previewStatus: browser.isPreview ? "idle" : browser.previewStatus,
        },
      ]),
    ),
  };
}
