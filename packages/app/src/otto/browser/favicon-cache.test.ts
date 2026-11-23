import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_FAVICON_FAILURE_RETRY_MS,
  browserFaviconCacheKey,
  createBrowserFaviconCache,
  type BrowserFaviconLoader,
} from "./favicon-cache";

const lookup = {
  browserId: "b1",
  faviconUrl: "http://127.0.0.1:4300/favicon.ico",
  pageUrl: "http://127.0.0.1:4300/app",
};
const DATA_URL = "data:image/png;base64,AAAA";

describe("browser favicon cache", () => {
  it("is unresolved until loaded, then answers synchronously", async () => {
    const loader = vi.fn<BrowserFaviconLoader>(async () => DATA_URL);
    const cache = createBrowserFaviconCache({ loader: () => loader });
    expect(cache.peek(lookup)).toBeUndefined();
    await expect(cache.load(lookup)).resolves.toBe(DATA_URL);
    expect(cache.peek(lookup)).toBe(DATA_URL);
  });

  it("asks main once even when the tab icon remounts repeatedly", async () => {
    const loader = vi.fn<BrowserFaviconLoader>(async () => null);
    const cache = createBrowserFaviconCache({ loader: () => loader });
    await Promise.all([cache.load(lookup), cache.load(lookup)]);
    await cache.load(lookup);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.peek(lookup)).toBeNull();
  });

  it("treats a rejected or non-data answer as no favicon, once", async () => {
    const rejecting = vi.fn<BrowserFaviconLoader>(async () => {
      throw new Error("ipc failed");
    });
    const cache = createBrowserFaviconCache({ loader: () => rejecting });
    await expect(cache.load(lookup)).resolves.toBeNull();
    await cache.load(lookup);
    expect(rejecting).toHaveBeenCalledTimes(1);

    const remote = createBrowserFaviconCache({
      loader: () => async () => "https://example.com/favicon.ico",
    });
    await expect(remote.load(lookup)).resolves.toBeNull();
  });

  it("retries a failed lookup after the retry window, but not a broken image", async () => {
    let clock = 0;
    const loader = vi.fn<BrowserFaviconLoader>(async () => null);
    const cache = createBrowserFaviconCache({ loader: () => loader, now: () => clock });
    await cache.load(lookup);
    clock = BROWSER_FAVICON_FAILURE_RETRY_MS - 1;
    expect(cache.peek(lookup)).toBeNull();
    clock = BROWSER_FAVICON_FAILURE_RETRY_MS;
    expect(cache.peek(lookup)).toBeUndefined();
    loader.mockResolvedValueOnce(DATA_URL);
    await expect(cache.load(lookup)).resolves.toBe(DATA_URL);
    expect(loader).toHaveBeenCalledTimes(2);

    cache.markBroken(lookup);
    clock += BROWSER_FAVICON_FAILURE_RETRY_MS * 10;
    expect(cache.peek(lookup)).toBeNull();
  });

  it("resolves to no favicon without a desktop bridge", async () => {
    const cache = createBrowserFaviconCache({ loader: () => null });
    await expect(cache.load(lookup)).resolves.toBeNull();
    expect(cache.peek(lookup)).toBeNull();
  });

  it("stops offering a favicon the renderer could not decode", async () => {
    const cache = createBrowserFaviconCache({ loader: () => async () => DATA_URL });
    await cache.load(lookup);
    cache.markBroken(lookup);
    expect(cache.peek(lookup)).toBeNull();
  });

  it("keys by favicon url and page origin, and stays bounded", async () => {
    expect(browserFaviconCacheKey(lookup)).toBe(
      browserFaviconCacheKey({ ...lookup, pageUrl: "http://127.0.0.1:4300/other" }),
    );
    const loader = vi.fn<BrowserFaviconLoader>(async () => DATA_URL);
    const cache = createBrowserFaviconCache({ loader: () => loader, limit: 1 });
    await cache.load(lookup);
    await cache.load({ ...lookup, faviconUrl: "https://example.com/icon.png" });
    expect(cache.peek(lookup)).toBeUndefined();
  });
});
