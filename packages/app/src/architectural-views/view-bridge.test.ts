/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERACTIVE_VIEW_MESSAGE_PREFIX,
  buildInteractiveViewGuestScript,
  parseInteractiveViewGuestEvent,
  prepareInteractiveViewDocument,
  serializeInteractiveViewCommand,
  type InteractiveViewCommand,
  type InteractiveViewCommandResult,
} from "./view-bridge";

const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'\">";

describe("prepareInteractiveViewDocument", () => {
  it("injects the theme and bridge right after the CSP, ahead of the viewer's head script", () => {
    const html = `<!doctype html><html data-theme="dark"><head>${CSP}<script>viewerHead()</script></head><body></body></html>`;

    const prepared = prepareInteractiveViewDocument(html, { scheme: "light", css: "a{}" });

    const csp = prepared.indexOf(CSP);
    const style = prepared.indexOf('<style id="otto-view-theme">a{}</style>');
    const viewer = prepared.indexOf("viewerHead()");
    expect(csp).toBeGreaterThanOrEqual(0);
    expect(style).toBe(csp + CSP.length);
    expect(style).toBeLessThan(viewer);
  });

  it("falls back to the head opening tag", () => {
    const prepared = prepareInteractiveViewDocument("<html><head><title>x</title></head></html>", {
      scheme: "dark",
      css: "",
    });

    expect(prepared.startsWith('<html><head><style id="otto-view-theme">')).toBe(true);
  });

  it("cannot be closed early by theme text", () => {
    const prepared = prepareInteractiveViewDocument("<head></head>", {
      scheme: "dark",
      css: "a{}</style><script>bad()</script>",
    });

    expect(prepared).not.toContain("</style><script>bad()");
  });
});

describe("parseInteractiveViewGuestEvent", () => {
  const encode = (value: unknown) => `${INTERACTIVE_VIEW_MESSAGE_PREFIX}${JSON.stringify(value)}`;
  const state = {
    scale: 1.25,
    components: 4,
    relationships: 3,
    motion: null,
    finderOpen: false,
    lensOpen: true,
    routeOpen: false,
    mapOpen: false,
    guideOpen: false,
  };

  it("ignores messages that are not the View's", () => {
    expect(parseInteractiveViewGuestEvent("hello")).toBeNull();
    expect(parseInteractiveViewGuestEvent(`${INTERACTIVE_VIEW_MESSAGE_PREFIX}{bad`)).toBeNull();
    expect(parseInteractiveViewGuestEvent(42)).toBeNull();
  });

  it("re-reads guest state into bounded fields", () => {
    const event = parseInteractiveViewGuestEvent(
      encode({ type: "state", state: { ...state, components: -3, extra: "x" } }),
    );

    expect(event).toEqual({ type: "state", state: { ...state, components: 0 } });
  });

  it("accepts only supported export files and sanitizes their names", () => {
    const accepted = parseInteractiveViewGuestEvent(
      encode({
        type: "result",
        id: 7,
        result: {
          ok: true,
          state,
          file: {
            fileName: "../web:app?.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,AA",
          },
        },
      }),
    );
    expect(accepted).toMatchObject({
      type: "result",
      id: 7,
      result: { ok: true, file: { fileName: "..-web-app-.png", mimeType: "image/png" } },
    });

    const rejected = parseInteractiveViewGuestEvent(
      encode({
        type: "result",
        id: 8,
        result: {
          ok: true,
          state,
          file: { fileName: "x.html", mimeType: "text/html", dataUrl: "data:text/html,<b>" },
        },
      }),
    );
    expect(rejected).toMatchObject({ result: { ok: false } });
  });
});

describe("serializeInteractiveViewCommand", () => {
  it("escapes markup so a command can never close a script", () => {
    const serialized = serializeInteractiveViewCommand({
      type: "theme",
      scheme: "dark",
      css: "</script>",
    });

    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toMatchObject({ css: "</script>" });
  });
});

interface GuestBridge {
  run: (command: InteractiveViewCommand) => Promise<InteractiveViewCommandResult>;
}

describe("guest bridge", () => {
  let posted: string[];
  let exportRun: (format: string) => Promise<void>;

  function install(scheme: "light" | "dark") {
    document.documentElement.innerHTML =
      '<head><style id="otto-view-theme">old</style></head><body><div class="diagram-container"><svg></svg></div></body>';
    window.eval(buildInteractiveViewGuestScript(scheme));
    (window as unknown as { Archify: unknown }).Archify = {
      view: { state: () => ({ scale: 1.5 }), zoomIn: () => undefined },
      guide: { facts: () => ({ nodes: 5, relationships: 4 }) },
      exportMenu: { run: (format: string) => exportRun(format) },
    };
    return (window as unknown as { __OTTO_VIEW__: GuestBridge }).__OTTO_VIEW__;
  }

  beforeEach(() => {
    posted = [];
    delete (window as unknown as { __OTTO_VIEW__?: unknown }).__OTTO_VIEW__;
    let counter = 0;
    URL.createObjectURL = () => `blob:view/${++counter}`;
    URL.revokeObjectURL = () => undefined;
    // A top-level guest (the Electron webview) reports through the console.
    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      posted.push(String(message));
    });
    exportRun = async () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { Archify?: unknown }).Archify;
  });

  it("pins Otto's scheme and the single classic presentation", () => {
    install("light");

    expect(document.documentElement.getAttribute("data-otto-view")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-preset")).toBe("classic");
    expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(true);
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
  });

  it("applies a live theme change without reloading", async () => {
    const bridge = install("dark");

    const result = await bridge.run({ type: "theme", scheme: "light", css: "new" });

    expect(result).toMatchObject({ ok: true, state: { scale: 1.5, components: 5 } });
    expect(document.getElementById("otto-view-theme")?.textContent).toBe("new");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("hands a viewer export to the host instead of downloading it", async () => {
    const bridge = install("dark");
    exportRun = async () => {
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(new Blob(["png"], { type: "image/png" }));
      anchor.download = "web-app.png";
      anchor.click();
    };

    const result = await bridge.run({ type: "export", format: "png" });

    expect(result).toMatchObject({
      ok: true,
      file: { fileName: "web-app.png", mimeType: "image/png" },
    });
    expect(result.ok && result.file?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("turns a viewer alert during export into a failed result", async () => {
    const bridge = install("dark");
    exportRun = async () => {
      window.alert("Export failed: canvas too large");
    };

    const result = await bridge.run({ type: "export", format: "png" });

    expect(result).toEqual({ ok: false, error: "Export failed: canvas too large" });
  });

  it("routes a stray viewer alert to the host as a notice", () => {
    install("dark");

    window.alert("Clipboard unavailable");

    expect(posted).toContain(
      `${INTERACTIVE_VIEW_MESSAGE_PREFIX}${JSON.stringify({ type: "notice", message: "Clipboard unavailable" })}`,
    );
  });

  it("carries the on-screen mono font into exported SVG", () => {
    install("dark");
    document.getElementById("otto-view-theme")!.textContent =
      "@font-face { font-family: 'OttoMono'; src: url(data:font/ttf;base64,AA); }\n" +
      "@font-face { font-family: 'OttoSans'; src: url(data:font/ttf;base64,BB); }\n" +
      ".diagram-container svg { font-family: OttoMono, monospace; }";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent =
      "@font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: local('JetBrains Mono'); }\n" +
      "svg { font-family: 'JetBrains Mono', ui-monospace, monospace; }\n" +
      ".c-node { fill: red; }";
    svg.appendChild(style);

    const serialized = new XMLSerializer().serializeToString(svg);

    expect(serialized).not.toContain("JetBrains Mono");
    expect(serialized).toContain("svg { font-family: OttoMono, monospace; }");
    expect(serialized).toContain("OttoMono");
    expect(serialized).toContain("base64,AA");
    expect(serialized).not.toContain("OttoSans");
    expect(serialized).toContain(".c-node { fill: red; }");
  });

  it("claims the viewer's theme, style, stage, and export shortcuts", () => {
    install("dark");
    const theme = new KeyboardEvent("keydown", { key: "t", cancelable: true, bubbles: true });
    const zoom = new KeyboardEvent("keydown", { key: "+", cancelable: true, bubbles: true });

    document.body.dispatchEvent(theme);
    document.body.dispatchEvent(zoom);

    expect(theme.defaultPrevented).toBe(true);
    expect(zoom.defaultPrevented).toBe(false);
  });
});
