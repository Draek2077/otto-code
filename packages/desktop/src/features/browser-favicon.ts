// Browser-tab favicons, resolved in the main process.
//
// The app renderer's CSP only allows `img-src 'self' data: blob:`, and it must
// stay that way: the renderer is privileged, so letting it load arbitrary
// remote images would be a tracking and attack-surface regression. Instead the
// renderer hands main the favicon URL the guest reported, main fetches it with
// the guest's own session (so cookies and profile match the tab), validates it
// is a bounded image, and returns a data: URL the CSP already permits.
//
// Every outcome is cached per URL (bounded LRU). Successes live for the life of
// the process; a failure is remembered for BROWSER_FAVICON_FAILURE_TTL_MS, so a
// broken favicon is never retried in a loop, but a local dev server that was
// down when its tab first loaded gets its icon once it is up.

export const BROWSER_FAVICON_MAX_BYTES = 256 * 1024;
export const BROWSER_FAVICON_CACHE_LIMIT = 256;
export const BROWSER_FAVICON_TIMEOUT_MS = 8_000;
export const BROWSER_FAVICON_FAILURE_TTL_MS = 2 * 60_000;
const MAX_FAVICON_URL_LENGTH = 4096;
const MAX_BROWSER_ID_LENGTH = 256;

export interface BrowserFaviconRequest {
  browserId: string;
  faviconUrl: string | null;
  pageUrl: string | null;
}

export interface BrowserFaviconResponse {
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type BrowserFaviconFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<BrowserFaviconResponse>;

export interface BrowserFaviconResolver {
  /** Tries each candidate in order and returns the first usable image as a data: URL. */
  resolve(input: { candidates: string[]; fetch: BrowserFaviconFetch }): Promise<string | null>;
  clear(): void;
}

interface BrowserFaviconResolverOptions {
  maxBytes?: number;
  cacheLimit?: number;
  failureTtlMs?: number;
  now?: () => number;
  timeoutMs?: number;
  warn?: (event: "fetch-failed", details: Record<string, unknown>) => void;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FAVICON_URL_LENGTH
    ? value
    : null;
}

export function readBrowserFaviconRequest(raw: unknown): BrowserFaviconRequest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const browserId = typeof record.browserId === "string" ? record.browserId.trim() : "";
  if (browserId.length === 0 || browserId.length > MAX_BROWSER_ID_LENGTH) {
    return null;
  }
  return {
    browserId,
    faviconUrl: readOptionalString(record.faviconUrl),
    pageUrl: readOptionalString(record.pageUrl),
  };
}

function parseFetchableUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  return url;
}

function isInlineImageUrl(value: string): boolean {
  return value.slice(0, 11).toLowerCase() === "data:image/";
}

/**
 * The page-declared favicon first, then the conventional `/favicon.ico` on the
 * page's own origin. Only http(s) and inline `data:image/` URLs survive.
 */
export function buildBrowserFaviconCandidates(input: {
  faviconUrl: string | null;
  pageUrl: string | null;
}): string[] {
  const candidates: string[] = [];
  const push = (candidate: string) => {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };
  if (input.faviconUrl) {
    if (isInlineImageUrl(input.faviconUrl)) {
      push(input.faviconUrl);
    } else {
      const parsed = parseFetchableUrl(input.faviconUrl);
      if (parsed) {
        push(parsed.href);
      }
    }
  }
  const page = input.pageUrl ? parseFetchableUrl(input.pageUrl) : null;
  if (page) {
    push(new URL("/favicon.ico", page).href);
  }
  return candidates;
}

function normalizeContentType(value: string | null): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

// Servers commonly label favicon.ico as octet-stream or leave it unlabeled; in
// that case the bytes decide. Anything explicitly non-image (an HTML soft 404,
// JSON, script) is rejected without reading the body.
function isSniffableContentType(contentType: string): boolean {
  return (
    contentType === "" ||
    contentType === "application/octet-stream" ||
    contentType === "binary/octet-stream"
  );
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffFaviconMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  return null;
}

/** Declared `image/*` wins; unlabeled or octet-stream bodies are sniffed; everything else is rejected. */
export function resolveFaviconMimeType(
  contentType: string | null,
  bytes: Uint8Array,
): string | null {
  const normalized = normalizeContentType(contentType);
  if (/^image\/[a-z0-9.+-]+$/.test(normalized)) {
    return normalized;
  }
  return isSniffableContentType(normalized) ? sniffFaviconMimeType(bytes) : null;
}

/** Reads at most `maxBytes`; returns null (and cancels the stream) when the body is larger. */
export async function readCappedBody(
  response: BrowserFaviconResponse,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function createBrowserFaviconResolver(
  options: BrowserFaviconResolverOptions = {},
): BrowserFaviconResolver {
  const maxBytes = options.maxBytes ?? BROWSER_FAVICON_MAX_BYTES;
  const cacheLimit = Math.max(1, options.cacheLimit ?? BROWSER_FAVICON_CACHE_LIMIT);
  const timeoutMs = options.timeoutMs ?? BROWSER_FAVICON_TIMEOUT_MS;
  const failureTtlMs = options.failureTtlMs ?? BROWSER_FAVICON_FAILURE_TTL_MS;
  const now = options.now ?? Date.now;
  // Holds the promise, not the value, so concurrent requests for one URL share
  // a single fetch. Map insertion order doubles as LRU order.
  const cache = new Map<string, { value: Promise<string | null>; failedAt: number | null }>();

  async function fetchOne(url: string, fetchImpl: BrowserFaviconFetch): Promise<string | null> {
    if (isInlineImageUrl(url)) {
      // Base64 inflates by 4/3; allow the same decoded budget as a fetched icon.
      return url.length <= Math.ceil((maxBytes * 4) / 3) + 64 ? url : null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (!contentType.startsWith("image/") && !isSniffableContentType(contentType)) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const bytes = await readCappedBody(response, maxBytes);
      if (!bytes || bytes.byteLength === 0) {
        return null;
      }
      const mimeType = resolveFaviconMimeType(contentType, bytes);
      return mimeType ? `data:${mimeType};base64,${toBase64(bytes)}` : null;
    } catch (error) {
      options.warn?.("fetch-failed", { url, error });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function cached(url: string, fetchImpl: BrowserFaviconFetch): Promise<string | null> {
    const existing = cache.get(url);
    if (existing) {
      cache.delete(url);
      if (existing.failedAt === null || now() - existing.failedAt < failureTtlMs) {
        cache.set(url, existing);
        return existing.value;
      }
    }
    const entry: { value: Promise<string | null>; failedAt: number | null } = {
      value: fetchOne(url, fetchImpl).then((dataUrl) => {
        if (dataUrl === null) {
          entry.failedAt = now();
        }
        return dataUrl;
      }),
      failedAt: null,
    };
    const pending = entry.value;
    cache.set(url, entry);
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return pending;
  }

  return {
    async resolve({ candidates, fetch }) {
      for (const candidate of candidates) {
        const dataUrl = await cached(candidate, fetch);
        if (dataUrl) {
          return dataUrl;
        }
      }
      return null;
    },
    clear() {
      cache.clear();
    },
  };
}
