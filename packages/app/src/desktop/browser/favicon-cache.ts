/**
 * Renderer-side memo for browser-tab favicons.
 *
 * The app renderer never loads a page's favicon URL directly: its CSP only
 * allows `img-src 'self' data: blob:`. The desktop main process fetches the
 * icon with the tab's own session and returns a data: URL (or null). This
 * cache keeps that answer so the tab icon, which remounts on every descriptor
 * change, does not re-ask main. A failed fetch is retried only after
 * BROWSER_FAVICON_FAILURE_RETRY_MS, matching main's failure TTL.
 */

export interface BrowserFaviconLookup {
  browserId: string;
  faviconUrl: string;
  pageUrl: string | null;
}

export type BrowserFaviconLoader = (lookup: BrowserFaviconLookup) => Promise<string | null>;

export interface BrowserFaviconCache {
  /** `undefined` means not resolved yet; `null` means resolved to "no favicon". */
  peek(lookup: BrowserFaviconLookup): string | null | undefined;
  load(lookup: BrowserFaviconLookup): Promise<string | null>;
  /** The data URL decoded badly in the renderer; stop offering it. */
  markBroken(lookup: BrowserFaviconLookup): void;
}

export const BROWSER_FAVICON_RENDERER_CACHE_LIMIT = 256;
export const BROWSER_FAVICON_FAILURE_RETRY_MS = 2 * 60_000;

function pageOrigin(pageUrl: string | null): string {
  if (!pageUrl) return "";
  try {
    return new URL(pageUrl).origin;
  } catch {
    return "";
  }
}

/** The same favicon URL can resolve differently only if its `/favicon.ico` fallback origin differs. */
export function browserFaviconCacheKey(lookup: BrowserFaviconLookup): string {
  return `${lookup.faviconUrl}\n${pageOrigin(lookup.pageUrl)}`;
}

export function createBrowserFaviconCache(input: {
  loader: () => BrowserFaviconLoader | null;
  limit?: number;
  now?: () => number;
}): BrowserFaviconCache {
  const now = input.now ?? Date.now;
  const limit = Math.max(1, input.limit ?? BROWSER_FAVICON_RENDERER_CACHE_LIMIT);
  const resolved = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();
  // Fetch failures that may succeed later (a dev server not up yet). Broken
  // images and a missing bridge are not retryable and never land here.
  const retryableFailures = new Map<string, number>();

  function isExpired(key: string): boolean {
    const failedAt = retryableFailures.get(key);
    if (failedAt === undefined || now() - failedAt < BROWSER_FAVICON_FAILURE_RETRY_MS) {
      return false;
    }
    retryableFailures.delete(key);
    resolved.delete(key);
    return true;
  }

  function remember(key: string, value: string | null) {
    retryableFailures.delete(key);
    resolved.delete(key);
    resolved.set(key, value);
    while (resolved.size > limit) {
      const oldest = resolved.keys().next().value;
      if (oldest === undefined) break;
      resolved.delete(oldest);
      retryableFailures.delete(oldest);
    }
  }

  return {
    peek(lookup) {
      const key = browserFaviconCacheKey(lookup);
      isExpired(key);
      return resolved.has(key) ? (resolved.get(key) ?? null) : undefined;
    },
    load(lookup) {
      const key = browserFaviconCacheKey(lookup);
      isExpired(key);
      if (resolved.has(key)) {
        return Promise.resolve(resolved.get(key) ?? null);
      }
      const inFlight = pending.get(key);
      if (inFlight) {
        return inFlight;
      }
      const loader = input.loader();
      if (!loader) {
        // No desktop bridge (plain web, native, or an older desktop shell):
        // there is no safe way to fetch the icon, so the tab keeps its Globe.
        remember(key, null);
        return Promise.resolve(null);
      }
      const request = loader(lookup)
        .then((value) =>
          typeof value === "string" && value.startsWith("data:image/") ? value : null,
        )
        .catch(() => null)
        .then((value) => {
          pending.delete(key);
          remember(key, value);
          if (value === null) {
            retryableFailures.set(key, now());
          }
          return value;
        });
      pending.set(key, request);
      return request;
    },
    markBroken(lookup) {
      remember(browserFaviconCacheKey(lookup), null);
    },
  };
}
