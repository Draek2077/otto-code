import { afterEach, describe, expect, it, vi } from "vitest";
import type { MathWebViewInbound, MathWebViewOutbound } from "./math-webview-contract";
import { mathWebViewHtml } from "./math-webview-html";

// The generated payload, driven through its own bridge in a real browser.
//
// Native rendering cannot be verified from this tier: there is no
// react-native-webview here. What *can* be verified is the half that actually
// breaks: that the bundle the build script produced boots, that KaTeX inside it
// renders and measures a formula, that the colour and size the host hands over
// are applied, and that malformed TeX comes back as an error rather than as
// markup. A regression in any of those is a regression in the generated file,
// which is committed and therefore easy to leave stale.

interface Harness {
  frame: HTMLIFrameElement;
  messages: MathWebViewOutbound[];
  send: (message: MathWebViewInbound) => void;
  document: Document;
}

const frames: HTMLIFrameElement[] = [];

const VIEWPORT_WIDTH = 320;

function boot(): Harness {
  const frame = document.createElement("iframe");
  frame.width = String(VIEWPORT_WIDTH);
  frame.height = "600";
  document.body.appendChild(frame);
  frames.push(frame);

  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) throw new Error("iframe has no document");

  const messages: MathWebViewOutbound[] = [];
  // Stands in for the react-native-webview bridge. Set before the payload runs;
  // document.write replaces the document but keeps this same window.
  (view as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView = {
    postMessage: (data: string) => messages.push(JSON.parse(data) as MathWebViewOutbound),
  };

  doc.open();
  doc.write(mathWebViewHtml);
  doc.close();

  return {
    frame,
    messages,
    document: frame.contentDocument ?? doc,
    send: (message) => {
      const receive = (
        frame.contentWindow as unknown as {
          __OTTO_MATH_WEBVIEW_RECEIVE__?: (message: MathWebViewInbound) => void;
        }
      ).__OTTO_MATH_WEBVIEW_RECEIVE__;
      if (!receive) throw new Error("payload never installed its receiver");
      receive(message);
    },
  };
}

function render(harness: Harness, tex: string, display = true, requestId = 1): void {
  harness.send({
    type: "render",
    requestId,
    tex,
    display,
    color: "rgb(230, 230, 230)",
    fontSize: 14,
  });
}

async function settled(harness: Harness, type: "rendered" | "error") {
  return vi.waitFor(() => {
    const message = harness.messages.find((entry) => entry.type === type);
    if (!message) throw new Error(`no ${type} message yet`);
    return message;
  });
}

afterEach(() => {
  while (frames.length > 0) frames.pop()?.remove();
});

describe("the math webview payload", () => {
  it("announces itself so the host knows the bridge is live", () => {
    const harness = boot();
    expect(harness.messages).toEqual([{ type: "ready" }]);
  });

  it("renders a formula and reports a size the host can use", async () => {
    const harness = boot();
    render(harness, String.raw`\frac{a}{b}`);

    const message = await settled(harness, "rendered");
    expect(message).toMatchObject({ type: "rendered", requestId: 1 });
    if (message.type !== "rendered") throw new Error("unreachable");
    expect(message.height).toBeGreaterThan(0);
    expect(message.width).toBeGreaterThan(0);

    // Real structure, not a string of TeX: KaTeX's HTML output, which is the
    // half the web renderer deliberately does not use.
    const root = harness.document.getElementById("math-root");
    expect(root?.querySelector(".katex")).not.toBeNull();
    expect(root?.querySelector(".katex-html")).not.toBeNull();
  });

  // The formula has no surrounding document to inherit from, so the host has to
  // hand both over or the formula renders black at the browser's default size.
  it("takes its colour and size from the host", async () => {
    const harness = boot();
    render(harness, "x^2");
    await settled(harness, "rendered");

    const body = harness.document.body;
    expect(harness.frame.contentWindow?.getComputedStyle(body).color).toBe("rgb(230, 230, 230)");
    expect(harness.frame.contentWindow?.getComputedStyle(body).fontSize).toBe("14px");
  });

  // KaTeX's fonts are inlined into the payload; if the @font-face rules broke,
  // the formula would silently fall back to the system font.
  it("carries KaTeX's own fonts", async () => {
    const harness = boot();
    render(harness, String.raw`\sqrt{x}`);
    await settled(harness, "rendered");

    const faces = [...(harness.document.fonts as unknown as Iterable<FontFace>)];
    expect(faces.some((face) => face.family.includes("KaTeX"))).toBe(true);
  });

  // A long equation is genuinely wider than a phone. Scaling keeps all of it;
  // clipping would silently drop the right-hand side of a statement.
  it("scales a formula that is wider than the pane down to fit", async () => {
    const harness = boot();
    render(harness, String.raw`a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p`);

    const message = await settled(harness, "rendered");
    if (message.type !== "rendered") throw new Error("unreachable");
    // `offsetWidth` is the untransformed layout width, so this asserts the
    // formula really did overflow and that the reported size is the scaled one.
    const natural = harness.document.getElementById("math-root")?.offsetWidth ?? 0;
    expect(natural).toBeGreaterThan(VIEWPORT_WIDTH);
    expect(message.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(message.height).toBeGreaterThan(0);
  });

  // A typo in someone else's README must reach the host as an error, so it can
  // show the source the way the web renderer does.
  it("reports unparseable TeX instead of rendering it", async () => {
    const harness = boot();
    render(harness, String.raw`\frac{`);

    const message = await settled(harness, "error");
    expect(message).toMatchObject({ type: "error", requestId: 1 });
    expect(harness.messages.some((entry) => entry.type === "rendered")).toBe(false);
    expect(harness.document.getElementById("math-root")?.innerHTML).toBe("");
  });

  // The host discards anything that is not its newest request, which only works
  // if the id makes the round trip.
  it("echoes the request id back", async () => {
    const harness = boot();
    render(harness, "x^2", true, 7);

    const message = await settled(harness, "rendered");
    expect(message).toMatchObject({ requestId: 7 });
  });
});
