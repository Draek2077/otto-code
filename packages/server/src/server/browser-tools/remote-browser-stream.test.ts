import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TabStream } from "./remote-browser-stream.js";

const SIZE = { width: 390, height: 844 };

interface PushedFrame {
  data: string;
  sessionId: number;
}

/** A Chromium page that pushes the frames a test hands it. */
class FakePage {
  readonly sent: string[] = [];
  readonly acknowledged: number[] = [];
  screenshots = 0;
  screenshot = Buffer.from("screenshot");
  private listener: ((event: PushedFrame) => void) | null = null;
  private nextSessionId = 0;

  constructor(private readonly canPush = true) {}

  asPage(): Page {
    const session = {
      on: (_event: string, listener: (event: PushedFrame) => void) => {
        this.listener = listener;
      },
      send: async (method: string, params?: { sessionId?: number }) => {
        this.sent.push(method);
        if (method === "Page.startScreencast" && !this.canPush)
          throw new Error("screencast is unavailable");
        if (method === "Page.screencastFrameAck") this.acknowledged.push(params!.sessionId!);
      },
      detach: async () => undefined,
    };
    return {
      context: () => ({ newCDPSession: async () => session }),
      screenshot: async () => {
        this.screenshots++;
        return this.screenshot;
      },
    } as unknown as Page;
  }

  push(content: string | Buffer): number {
    const sessionId = ++this.nextSessionId;
    this.listener?.({ data: Buffer.from(content).toString("base64"), sessionId });
    return sessionId;
  }
}

function decode(frame: { image: Buffer } | undefined): string | undefined {
  return frame?.image.toString();
}

describe("hosted tab frame stream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a held request is answered by the page's next repaint", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());

    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    page.push("first paint");
    const shown = await first;
    expect(decode(shown)).toBe("first paint");
    expect(page.screenshots).toBe(0);

    let answered = false;
    const held = stream
      .next({ size: SIZE, knownRevision: shown!.revision, waitMs: 10_000, binary: false })
      .then((frame) => {
        answered = true;
        return frame;
      });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(answered).toBe(false);

    page.push("second paint");
    expect(decode(await held)).toBe("second paint");
  });

  test("a still page answers a held request with no frame", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    page.push("paint");
    const shown = await first;

    const held = stream.next({
      size: SIZE,
      knownRevision: shown!.revision,
      waitMs: 2_000,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await held).toBeUndefined();
    expect(stream.stats()).toMatchObject({ framesSent: 1, captures: 0 });
  });

  test("a repaint that looks the same is not sent again", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    page.push("paint");
    const shown = await first;

    const held = stream.next({
      size: SIZE,
      knownRevision: shown!.revision,
      waitMs: 1_000,
      binary: false,
    });
    page.push("paint");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await held).toBeUndefined();
    expect(stream.stats()).toMatchObject({ pushed: 2, unchanged: 1, framesSent: 1 });
  });

  test("a large frame waits longer for its acknowledgement than a small one", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);

    const small = page.push(Buffer.alloc(3_000, 1));
    await first;
    await vi.advanceTimersByTimeAsync(250);
    expect(page.acknowledged).toEqual([small]);

    // 120 KB at the idle budget of 40 KB/s on the wire is four seconds.
    const large = page.push(Buffer.alloc(120_000, 2));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(page.acknowledged).toEqual([small]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(page.acknowledged).toEqual([small, large]);
  });

  test("input releases the pending acknowledgement so the next frame comes at once", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    const frame = page.push(Buffer.alloc(120_000, 2));
    await first;
    expect(page.acknowledged).toEqual([]);

    stream.noteInput();
    await vi.advanceTimersByTimeAsync(0);
    expect(page.acknowledged).toEqual([frame]);
  });

  test("takes screenshots where Chromium cannot push frames", async () => {
    const page = new FakePage(false);
    const stream = new TabStream();
    stream.attach(page.asPage());

    const shown = await stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: 10_000,
      binary: false,
    });
    expect(decode(shown)).toBe("screenshot");
    expect(page.screenshots).toBe(1);

    // The same picture again is recognised and withheld.
    await vi.advanceTimersByTimeAsync(1_000);
    const again = await stream.next({
      size: SIZE,
      knownRevision: shown!.revision,
      waitMs: 10_000,
      binary: false,
    });
    expect(again).toBeUndefined();
    expect(stream.stats()).toMatchObject({ captures: 2, unchanged: 1, framesSent: 1 });
  });

  test("a viewer taking bytes is budgeted without the base64 overhead", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // 120 KB of bytes at 40 KB/s is three seconds, not the four base64 takes.
    const frame = page.push(Buffer.alloc(120_000, 2));
    await first;
    await vi.advanceTimersByTimeAsync(2_900);
    expect(page.acknowledged).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(page.acknowledged).toEqual([frame]);
    expect(stream.stats().bytesSent).toBe(120_000);
  });

  test("nobody watching stops the page from pushing", async () => {
    const page = new FakePage();
    const stream = new TabStream();
    stream.attach(page.asPage());
    const first = stream.next({
      size: SIZE,
      knownRevision: undefined,
      waitMs: undefined,
      binary: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    page.push("paint");
    await first;

    await vi.advanceTimersByTimeAsync(6_000);
    page.push("later paint");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.sent).toContain("Page.stopScreencast");
  });
});
