import { expect, test, vi } from "vitest";
import { createBrowserFaviconHandler, type FaviconSender } from "./favicon-ipc.js";
import type { BrowserFaviconFetch } from "./favicon.js";
const mainFrame = {};
const event: FaviconSender = { sender: { id: 42, mainFrame }, senderFrame: mainFrame };
function fixture() {
  const fetch = vi.fn<BrowserFaviconFetch>(
    async () =>
      new Response(new Uint8Array([0, 0, 1, 0, 1, 0]), {
        headers: { "content-type": "image/x-icon" },
      }),
  );
  const resolve = vi.fn(() => fetch);
  const handler = createBrowserFaviconHandler({
    trusted: (input) => input.sender.id === 42 && input.senderFrame === mainFrame,
    fetchForBrowser: resolve,
  });
  return { handler, fetch, resolve };
}
test("the app frame resolves the guest's icon through its owning host and session port", async () => {
  const f = fixture();
  await expect(
    f.handler.resolve(event, {
      browserId: "tab",
      faviconUrl: "https://fixture.test/icon.ico",
      pageUrl: "https://fixture.test/page",
    }),
  ).resolves.toBe("data:image/x-icon;base64,AAABAAEA");
  expect(f.resolve).toHaveBeenCalledWith("tab", 42);
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
test("guest frames, foreign windows and malformed requests cannot reach a profile fetch", async () => {
  const f = fixture();
  const input = { browserId: "tab", faviconUrl: "https://fixture.test/icon.ico" };
  await expect(f.handler.resolve({ ...event, senderFrame: {} }, input)).resolves.toBeNull();
  await expect(
    f.handler.resolve({ ...event, sender: { id: 99, mainFrame } }, input),
  ).resolves.toBeNull();
  await expect(
    f.handler.resolve(event, { browserId: "", faviconUrl: "https://fixture.test/icon.ico" }),
  ).resolves.toBeNull();
  await expect(
    f.handler.resolve(event, {
      browserId: "tab",
      faviconUrl: "file:///private",
      pageUrl: "javascript:bad",
    }),
  ).resolves.toBeNull();
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
});
test("a page without a declared icon uses its conventional favicon and shares the bounded cache", async () => {
  const f = fixture();
  const input = { browserId: "tab", faviconUrl: null, pageUrl: "https://fixture.test/page" };
  await f.handler.resolve(event, input);
  await f.handler.resolve(event, input);
  expect(f.fetch.mock.calls[0]?.[0]).toBe("https://fixture.test/favicon.ico");
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.handler.clear();
  await f.handler.resolve(event, input);
  expect(f.fetch).toHaveBeenCalledTimes(2);
});
