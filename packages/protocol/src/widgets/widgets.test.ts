import { describe, expect, test } from "vitest";
import {
  WIDGET_BRIDGE_CHANNEL,
  clampWidgetHeight,
  parseWidgetGuestMessage,
  WIDGET_MAX_HEIGHT_PX,
  WIDGET_MIN_HEIGHT_PX,
} from "./bridge.js";
import { buildWidgetDocument } from "./document.js";
import { buildWidgetThemeVariables } from "./theme.js";
import {
  WIDGET_METADATA_KEY,
  WIDGET_PAYLOAD_VERSION,
  detectWidgetMode,
  readWidgetPayload,
  type WidgetPayload,
} from "./types.js";

const PAYLOAD: WidgetPayload = {
  version: WIDGET_PAYLOAD_VERSION,
  id: "toolu_1",
  title: "revenue_by_region",
  mode: "html",
  code: "<p>hi</p>",
  loadingMessages: ["Counting"],
};

const THEME = {
  isDark: false,
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  foreground: "#18181b",
  foregroundMuted: "#71717a",
  border: "#d1d1d8",
  accent: "#2563eb",
  danger: "#dc2626",
  success: "#16a34a",
  fontSans: "Inter, sans-serif",
  fontMono: "Menlo, monospace",
};

describe("readWidgetPayload", () => {
  test("reads a payload out of the metadata bag", () => {
    expect(readWidgetPayload({ [WIDGET_METADATA_KEY]: PAYLOAD })).toEqual(PAYLOAD);
  });

  test("returns null rather than throwing for absent or malformed metadata", () => {
    expect(readWidgetPayload(undefined)).toBeNull();
    expect(readWidgetPayload({})).toBeNull();
    expect(readWidgetPayload({ [WIDGET_METADATA_KEY]: "nonsense" })).toBeNull();
    expect(readWidgetPayload({ [WIDGET_METADATA_KEY]: { version: 1 } })).toBeNull();
  });

  test("refuses a payload version this build does not understand", () => {
    // A newer daemon must degrade to the ordinary tool-call row, not guess.
    expect(readWidgetPayload({ [WIDGET_METADATA_KEY]: { ...PAYLOAD, version: 99 } })).toBeNull();
  });
});

describe("detectWidgetMode", () => {
  test("only a leading <svg is SVG mode", () => {
    expect(detectWidgetMode('<svg viewBox="0 0 1 1"/>')).toBe("svg");
    expect(detectWidgetMode('\n  <svg viewBox="0 0 1 1"/>')).toBe("svg");
    expect(detectWidgetMode("<svgfoo/>")).toBe("html");
    expect(detectWidgetMode("<div><svg/></div>")).toBe("html");
  });
});

describe("parseWidgetGuestMessage", () => {
  test("accepts both the JSON-string and structured transports", () => {
    const frame = {
      channel: WIDGET_BRIDGE_CHANNEL,
      widgetId: "toolu_1",
      type: "height" as const,
      px: 240,
    };
    expect(parseWidgetGuestMessage(JSON.stringify(frame))).toEqual(frame);
    expect(parseWidgetGuestMessage(frame)).toEqual(frame);
  });

  test("drops foreign traffic instead of throwing", () => {
    expect(parseWidgetGuestMessage("not json at all")).toBeNull();
    expect(parseWidgetGuestMessage({ type: "height", px: 1 })).toBeNull();
    expect(parseWidgetGuestMessage({ channel: "someone-else", type: "height", px: 1 })).toBeNull();
    expect(parseWidgetGuestMessage(null)).toBeNull();
  });
});

describe("clampWidgetHeight", () => {
  test("bounds a self-reported height", () => {
    expect(clampWidgetHeight(0)).toBe(WIDGET_MIN_HEIGHT_PX);
    expect(clampWidgetHeight(1e9)).toBe(WIDGET_MAX_HEIGHT_PX);
    expect(clampWidgetHeight(Number.NaN)).toBe(WIDGET_MIN_HEIGHT_PX);
    expect(clampWidgetHeight(240.2)).toBe(241);
  });
});

describe("buildWidgetDocument", () => {
  const html = buildWidgetDocument({ payload: PAYLOAD, theme: THEME });

  test("locks the guest down with a no-network CSP", () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
  });

  test("inlines the fragment verbatim and carries the bridge", () => {
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("window.sendPrompt");
    expect(html).toContain("window.openLink");
    expect(html).toContain(JSON.stringify(PAYLOAD.id));
  });

  test("escapes the title into the document head", () => {
    const escaped = buildWidgetDocument({
      payload: { ...PAYLOAD, title: "</title><script>x</script>" },
      theme: THEME,
    });
    expect(escaped).not.toContain("<title></title><script>");
    expect(escaped).toContain("&lt;/title&gt;");
  });

  test("centers an SVG widget without touching an HTML one", () => {
    expect(buildWidgetDocument({ payload: { ...PAYLOAD, mode: "svg" }, theme: THEME })).toContain(
      "widget-svg",
    );
    expect(html).not.toContain("widget-svg");
  });
});

describe("buildWidgetThemeVariables", () => {
  test("emits concrete colors, never var() references", () => {
    const css = buildWidgetThemeVariables(THEME);
    expect(css).toContain("--surface-0: #ffffff;");
    expect(css).toContain("--text-primary: #18181b;");
    // Role tints are composited against the surface so they land opaque.
    expect(css).toMatch(/--bg-accent: #[0-9a-f]{6};/);
    expect(css).not.toContain("var(--colors-");
  });

  test("swaps the categorical palette between light and dark", () => {
    const light = buildWidgetThemeVariables(THEME);
    const dark = buildWidgetThemeVariables({ ...THEME, isDark: true });
    expect(light).toContain("--c-blue: #2563eb;");
    expect(dark).toContain("--c-blue: #60a5fa;");
  });
});
