import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorHoverAnswer, EditorThemeSpec } from "./editor-contract";
import { createEditorCore, type EditorCore } from "./editor-core";

// Hover tooltips against a real CM6 in a real browser, because the behaviour under
// test is entirely about timing inside CM6's own hover plugin: how long the source
// takes to return, whether the tooltip is returned synchronously, and what CM6 does
// with a pending promise when a view update lands. None of that survives a mock.
//
// The rule these cover: a language server that answers fast is indistinguishable from
// before, and one that answers slowly (or not yet) gets a tooltip that fills itself in
// rather than nothing at all.

const THEME: EditorThemeSpec = {
  background: "#101014",
  foreground: "#e6e6e6",
  gutterBackground: "#16161c",
  gutterForeground: "#6b6b76",
  gutterActiveForeground: "#e6e6e6",
  gutterBorder: "#26262e",
  rulerColumn: null,
  rulerColor: "#26262e",
  overviewRulerWidth: 14,
  overviewRulerBackground: "#16161c",
  overviewRulerBorder: "#26262e",
  overviewRulerThumb: "rgba(230, 230, 230, 0.18)",
  overviewRulerCursor: "#e6e6e6",
  overviewRulerSelection: "rgba(80, 130, 200, 0.20)",
  overviewRulerMatch: "#e0a030",
  scrollbarHandle: "#8a8a8a",
  tooltipBackground: "#2a2a2a",
  tooltipBorder: "#3a3a3a",
  tooltipShadow: "0px 6px 16px rgba(0, 0, 0, 0.6)",
  selectionBackground: "#2b3a55",
  cursor: "#e6e6e6",
  cursorWidth: 2,
  activeLineBackground: "rgba(255, 255, 255, 0.04)",
  searchMatchBackground: "rgba(255, 191, 0, 0.28)",
  searchMatchBorder: "rgba(255, 191, 0, 0.7)",
  activeSearchMatchBackground: "rgba(255, 191, 0, 0.45)",
  activeSearchMatchBorder: "#ffbf00",
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 20,
  syntax: resolveSyntaxColors("default", "dark"),
  diagnostic: { error: "#dc2626", warning: "#f59e0b", info: "#38bdf8", hint: "#94a3b8" },
};

const DOC = "const target = 1;\n";
const SYMBOL = "target";

// CM6's own pointer-rest delay, which this feature deliberately does not change.
const HOVER_TIME_MS = 300;

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

interface Mounted {
  host: HTMLElement;
  /** Positions the provider was asked about, so retries are observable. */
  asks: Array<{ line: number; column: number }>;
}

function mount(respond: (ask: number) => Promise<EditorHoverAnswer>): Mounted {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const asks: Array<{ line: number; column: number }> = [];
  const core = createEditorCore({
    parent: host,
    path: "src/example.ts",
    doc: DOC,
    theme: THEME,
    wordWrap: false,
    hoverProvider: (position) => {
      asks.push(position);
      return respond(asks.length);
    },
  });
  mounted.push({ core, host });
  return { host, asks };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Rest the pointer on `SYMBOL`. The coordinates come from a Range over the identifier
 * rather than from the line box's centre: CM6 resolves the hover position with
 * `posAtCoords`, so landing on the right character is the whole test.
 */
async function hoverSymbol(host: HTMLElement): Promise<void> {
  const line = host.querySelector(".cm-line");
  if (line === null) {
    throw new Error("editor did not render a line");
  }
  // Walked rather than read off `line.childNodes`: syntax highlighting wraps the
  // identifier in its own span, so the text node is a grandchild.
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let text: globalThis.Text | null = null;
  while (walker.nextNode() !== null) {
    const node = walker.currentNode as globalThis.Text;
    if ((node.textContent ?? "").includes(SYMBOL)) {
      text = node;
      break;
    }
  }
  if (text === null) {
    throw new Error("could not find the hover target's text node");
  }

  const start = (text.textContent ?? "").indexOf(SYMBOL);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + SYMBOL.length);
  const box = range.getBoundingClientRect();
  const clientX = box.left + box.width / 2;
  const clientY = box.top + box.height / 2;

  // Dispatched on the element that owns the text so the plugin's `tile.nearest`
  // lookup resolves; it bubbles to the listener CM6 installed on the editor root.
  text.parentElement?.dispatchEvent(
    new MouseEvent("mousemove", { clientX, clientY, bubbles: true }),
  );
  await sleep(HOVER_TIME_MS + 60);
}

function tooltip(): HTMLElement | null {
  return document.querySelector(".cm-tooltip .cm-otto-hover");
}

/**
 * Poll rather than sleep a fixed span: the tooltip appears one grace period after the
 * pointer-rest delay, and pinning the assertions to that sum would make every timing
 * constant in the editor a constant this file has to track.
 */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if (condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function isPending(): boolean {
  return document.querySelector(".cm-otto-hover-pending") !== null;
}

function content(): string {
  return tooltip()?.textContent ?? "";
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.core.destroy();
    entry.host.remove();
  }
});

describe("editor core hover tooltips", () => {
  it("renders a fast answer directly, never showing the pending state", async () => {
    const editor = mount(() =>
      Promise.resolve({ kind: "content", markdown: "**target**: a thing" }),
    );

    await hoverSymbol(editor.host);

    expect(isPending()).toBe(false);
    expect(content()).toContain("target");
    expect(editor.asks).toHaveLength(1);
  });

  it("shows the pending state for a slow answer, then fills it in", async () => {
    const editor = mount(async () => {
      await sleep(600);
      return { kind: "content", markdown: "**target**: arrived late" };
    });

    await hoverSymbol(editor.host);

    // The tooltip exists before its content does.
    await waitFor(() => tooltip() !== null, "the tooltip to open");
    expect(isPending()).toBe(true);

    await waitFor(() => !isPending(), "the answer to fill in");
    expect(content()).toContain("arrived late");
  });

  it("holds the tooltip open across a warming server and fills in when it answers", async () => {
    const editor = mount(async (ask) => {
      await sleep(200);
      return ask < 3 ? { kind: "warming" } : { kind: "content", markdown: "**target**: warm now" };
    });

    await hoverSymbol(editor.host);
    await waitFor(() => isPending(), "the pending state");

    await waitFor(() => content().includes("warm now"), "the warmed answer");
    expect(editor.asks.length).toBeGreaterThanOrEqual(3);
  });

  it("retracts the tooltip when a slow answer turns out to be nothing", async () => {
    const editor = mount(async () => {
      await sleep(400);
      return { kind: "none" };
    });

    await hoverSymbol(editor.host);
    await waitFor(() => tooltip() !== null, "the tooltip to open");
    expect(isPending()).toBe(true);

    await waitFor(() => tooltip() === null, "the tooltip to retract");
  });

  it("does not ask at all when the pointer rests off a word", async () => {
    const editor = mount(() => Promise.resolve({ kind: "content", markdown: "unreachable" }));

    const line = editor.host.querySelector(".cm-line");
    const box = line?.getBoundingClientRect();
    if (box === undefined) {
      throw new Error("editor did not render a line");
    }
    // Well past the end of "const target = 1;" - inside the line box, on no word.
    line?.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: box.right - 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
      }),
    );
    await sleep(HOVER_TIME_MS + 60);

    expect(editor.asks).toHaveLength(0);
    expect(tooltip()).toBeNull();
  });
});
