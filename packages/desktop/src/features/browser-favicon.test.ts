import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserFaviconCandidates,
  createBrowserFaviconResolver,
  readBrowserFaviconRequest,
  readCappedBody,
  resolveFaviconMimeType,
  sniffFaviconMimeType,
  type BrowserFaviconFetch,
  type BrowserFaviconResponse,
} from "./browser-favicon.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16]);

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function response(input: {
  ok?: boolean;
  contentType?: string | null;
  contentLength?: number;
  chunks?: Uint8Array[];
}): BrowserFaviconResponse {
  const headers = new Map<string, string>();
  if (input.contentType) headers.set("content-type", input.contentType);
  if (input.contentLength !== undefined) headers.set("content-length", String(input.contentLength));
  return {
    ok: input.ok ?? true,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: streamOf(input.chunks ?? []),
  };
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readBrowserFaviconRequest", () => {
  it("accepts a well-formed request and trims the browser id", () => {
    expect(
      readBrowserFaviconRequest({
        browserId: " b1 ",
        faviconUrl: "https://example.com/icon.png",
        pageUrl: "https://example.com/",
      }),
    ).toEqual({
      browserId: "b1",
      faviconUrl: "https://example.com/icon.png",
      pageUrl: "https://example.com/",
    });
  });

  it("rejects missing browser ids and drops non-string or oversized urls", () => {
    expect(readBrowserFaviconRequest(null)).toBeNull();
    expect(readBrowserFaviconRequest({ browserId: "  " })).toBeNull();
    expect(readBrowserFaviconRequest({ browserId: "x".repeat(300) })).toBeNull();
    expect(
      readBrowserFaviconRequest({
        browserId: "b1",
        faviconUrl: 42,
        pageUrl: `https://example.com/${"a".repeat(5000)}`,
      }),
    ).toEqual({ browserId: "b1", faviconUrl: null, pageUrl: null });
  });
});

describe("buildBrowserFaviconCandidates", () => {
  it("prefers the declared favicon, then falls back to the page origin's /favicon.ico", () => {
    expect(
      buildBrowserFaviconCandidates({
        faviconUrl: "https://cdn.example.com/fav.png",
        pageUrl: "https://app.example.com/deep/path?q=1",
      }),
    ).toEqual(["https://cdn.example.com/fav.png", "https://app.example.com/favicon.ico"]);
  });

  it("dedupes when the declared favicon is the conventional one", () => {
    expect(
      buildBrowserFaviconCandidates({
        faviconUrl: "http://127.0.0.1:4300/favicon.ico",
        pageUrl: "http://127.0.0.1:4300/",
      }),
    ).toEqual(["http://127.0.0.1:4300/favicon.ico"]);
  });

  it("drops non-http schemes and urls with embedded credentials", () => {
    expect(
      buildBrowserFaviconCandidates({ faviconUrl: "file:///etc/passwd", pageUrl: "about:blank" }),
    ).toEqual([]);
    expect(
      buildBrowserFaviconCandidates({
        faviconUrl: "https://user:pass@example.com/icon.png",
        pageUrl: null,
      }),
    ).toEqual([]);
    expect(
      buildBrowserFaviconCandidates({ faviconUrl: "javascript:alert(1)", pageUrl: null }),
    ).toEqual([]);
  });

  it("keeps inline data:image favicons", () => {
    expect(
      buildBrowserFaviconCandidates({ faviconUrl: "data:image/png;base64,AAAA", pageUrl: null }),
    ).toEqual(["data:image/png;base64,AAAA"]);
  });
});

describe("favicon mime detection", () => {
  it("sniffs common favicon formats", () => {
    expect(sniffFaviconMimeType(ICO_BYTES)).toBe("image/x-icon");
    expect(sniffFaviconMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffFaviconMimeType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe(
      "image/gif",
    );
    expect(sniffFaviconMimeType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
  });

  it("trusts declared image types, sniffs unlabeled bodies, rejects html", () => {
    expect(resolveFaviconMimeType("image/svg+xml; charset=utf-8", new Uint8Array([1]))).toBe(
      "image/svg+xml",
    );
    expect(resolveFaviconMimeType("application/octet-stream", ICO_BYTES)).toBe("image/x-icon");
    expect(resolveFaviconMimeType(null, PNG_BYTES)).toBe("image/png");
    expect(resolveFaviconMimeType("text/html", PNG_BYTES)).toBeNull();
  });
});

describe("readCappedBody", () => {
  it("rejects an oversized declared content-length without reading", async () => {
    const result = await readCappedBody(
      response({ contentLength: 2048, chunks: [new Uint8Array(10)] }),
      1024,
    );
    expect(result).toBeNull();
  });

  it("stops reading once the streamed body exceeds the cap", async () => {
    const result = await readCappedBody(
      response({ chunks: [new Uint8Array(600), new Uint8Array(600)] }),
      1024,
    );
    expect(result).toBeNull();
  });

  it("concatenates chunks within the cap", async () => {
    const result = await readCappedBody(
      response({ chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] }),
      1024,
    );
    expect(Array.from(result ?? [])).toEqual([1, 2, 3]);
  });
});

describe("createBrowserFaviconResolver", () => {
  it("returns a data URL for a valid image", async () => {
    const resolver = createBrowserFaviconResolver();
    const fetch = vi.fn<BrowserFaviconFetch>(async () =>
      response({ contentType: "image/png", chunks: [PNG_BYTES] }),
    );
    await expect(
      resolver.resolve({ candidates: ["https://example.com/icon.png"], fetch }),
    ).resolves.toBe(`data:image/png;base64,${base64(PNG_BYTES)}`);
  });

  it("falls through to the next candidate when the first is not an image", async () => {
    const resolver = createBrowserFaviconResolver();
    const fetch = vi.fn<BrowserFaviconFetch>(async (url) =>
      url.endsWith("/icon.png")
        ? response({ contentType: "text/html", chunks: [new TextEncoder().encode("<html>")] })
        : response({ contentType: "application/octet-stream", chunks: [ICO_BYTES] }),
    );
    await expect(
      resolver.resolve({
        candidates: ["https://example.com/icon.png", "https://example.com/favicon.ico"],
        fetch,
      }),
    ).resolves.toBe(`data:image/x-icon;base64,${base64(ICO_BYTES)}`);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects non-ok responses and oversized images", async () => {
    const resolver = createBrowserFaviconResolver({ maxBytes: 8 });
    const fetch = vi.fn<BrowserFaviconFetch>(async (url) =>
      url.includes("missing")
        ? response({ ok: false, contentType: "image/png", chunks: [PNG_BYTES] })
        : response({ contentType: "image/png", chunks: [PNG_BYTES] }),
    );
    await expect(
      resolver.resolve({
        candidates: ["https://example.com/missing.png", "https://example.com/big.png"],
        fetch,
      }),
    ).resolves.toBeNull();
  });

  it("caches failures so a broken favicon is fetched once, not in a loop", async () => {
    const warn = vi.fn();
    const resolver = createBrowserFaviconResolver({ warn });
    const fetch = vi.fn<BrowserFaviconFetch>(async () => {
      throw new Error("net::ERR_CONNECTION_REFUSED");
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        resolver.resolve({ candidates: ["http://127.0.0.1:4300/favicon.ico"], fetch }),
      ).resolves.toBeNull();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("retries a failed favicon once the failure TTL has passed", async () => {
    let clock = 0;
    const resolver = createBrowserFaviconResolver({ failureTtlMs: 1_000, now: () => clock });
    let serverUp = false;
    const fetch = vi.fn<BrowserFaviconFetch>(async () => {
      if (!serverUp) throw new Error("net::ERR_CONNECTION_REFUSED");
      return response({ contentType: "image/x-icon", chunks: [ICO_BYTES] });
    });
    const candidates = ["http://127.0.0.1:4300/favicon.ico"];

    await expect(resolver.resolve({ candidates, fetch })).resolves.toBeNull();
    serverUp = true;
    clock = 999;
    await expect(resolver.resolve({ candidates, fetch })).resolves.toBeNull();
    clock = 1_000;
    await expect(resolver.resolve({ candidates, fetch })).resolves.toBe(
      `data:image/x-icon;base64,${base64(ICO_BYTES)}`,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight fetch between concurrent requests", async () => {
    const resolver = createBrowserFaviconResolver();
    const fetch = vi.fn<BrowserFaviconFetch>(async () =>
      response({ contentType: "image/png", chunks: [PNG_BYTES] }),
    );
    const input = { candidates: ["https://example.com/icon.png"], fetch };
    const [first, second] = await Promise.all([resolver.resolve(input), resolver.resolve(input)]);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used entry beyond the cache bound", async () => {
    const resolver = createBrowserFaviconResolver({ cacheLimit: 2 });
    const fetch = vi.fn<BrowserFaviconFetch>(async () =>
      response({ contentType: "image/png", chunks: [PNG_BYTES] }),
    );
    const resolve = (url: string) => resolver.resolve({ candidates: [url], fetch });
    await resolve("https://a.test/a.png");
    await resolve("https://b.test/b.png");
    await resolve("https://a.test/a.png"); // touch a, so b is now oldest
    await resolve("https://c.test/c.png"); // evicts b
    expect(fetch).toHaveBeenCalledTimes(3);
    await resolve("https://a.test/a.png");
    expect(fetch).toHaveBeenCalledTimes(3);
    await resolve("https://b.test/b.png");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("aborts a fetch that exceeds the timeout", async () => {
    vi.useFakeTimers();
    const resolver = createBrowserFaviconResolver({ timeoutMs: 1000 });
    const fetch: BrowserFaviconFetch = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const pending = resolver.resolve({ candidates: ["https://slow.test/favicon.ico"], fetch });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeNull();
  });

  it("passes inline data:image favicons through without fetching, within the size cap", async () => {
    const resolver = createBrowserFaviconResolver({ maxBytes: 16 });
    const fetch = vi.fn<BrowserFaviconFetch>();
    await expect(
      resolver.resolve({ candidates: ["data:image/png;base64,AAAA"], fetch }),
    ).resolves.toBe("data:image/png;base64,AAAA");
    await expect(
      resolver.resolve({ candidates: [`data:image/png;base64,${"A".repeat(500)}`], fetch }),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
