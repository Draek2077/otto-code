import { describe, expect, test } from "vitest";
import { WIDGET_MAX_CODE_CHARS } from "@otto-code/protocol/widgets/types";

import {
  WidgetFragmentError,
  sanitizeWidgetFragment,
  sanitizeWidgetLoadingMessages,
  sanitizeWidgetTitle,
} from "./widget-fragment.js";

describe("sanitizeWidgetFragment", () => {
  test("strips a markdown code fence the model wrapped the fragment in", () => {
    expect(sanitizeWidgetFragment("```html\n<div>hi</div>\n```").code).toBe("<div>hi</div>");
  });

  test("unwraps a whole document to its body, carrying head styles down", () => {
    const result = sanitizeWidgetFragment(
      "<!DOCTYPE html><html><head><style>p{color:red}</style></head><body><p>hi</p></body></html>",
    );
    expect(result.code).toContain("<style>p{color:red}</style>");
    expect(result.code).toContain("<p>hi</p>");
    expect(result.code).not.toContain("<body");
  });

  test("does NOT truncate at </html> the way the artifact sanitizer does", () => {
    // The artifact validator cuts everything after </html>, which would silently
    // drop the back half of a fragment that merely mentions the tag.
    const result = sanitizeWidgetFragment("<p>before</p><code>&lt;/html&gt;</code><p>after</p>");
    expect(result.code).toContain("after");
  });

  test("rejects plain prose", () => {
    expect(() => sanitizeWidgetFragment("here is a chart of the data")).toThrow(
      WidgetFragmentError,
    );
  });

  test("rejects an empty fragment", () => {
    expect(() => sanitizeWidgetFragment("   \n  ")).toThrow(WidgetFragmentError);
  });

  test("flags truncation instead of failing on an oversized fragment", () => {
    const oversized = `<div>${"x".repeat(WIDGET_MAX_CODE_CHARS * 2)}</div>`;
    const result = sanitizeWidgetFragment(oversized);
    expect(result.truncated).toBe(true);
    // Cut to the cap, and the cut is stated in the document — a fragment
    // sliced mid-tag renders broken, so it must not fail silently.
    expect(result.code.startsWith(oversized.slice(0, WIDGET_MAX_CODE_CHARS))).toBe(true);
    expect(result.code).toContain("truncated");
  });

  test("detects svg mode only when the fragment leads with <svg", () => {
    expect(sanitizeWidgetFragment('<svg viewBox="0 0 1 1"></svg>').mode).toBe("svg");
    expect(sanitizeWidgetFragment('<div><svg viewBox="0 0 1 1"></svg></div>').mode).toBe("html");
  });
});

describe("sanitizeWidgetTitle", () => {
  test("falls back to a placeholder rather than an empty label", () => {
    expect(sanitizeWidgetTitle("   ")).toBe("widget");
  });
});

describe("sanitizeWidgetLoadingMessages", () => {
  test("drops blanks, caps the count, and survives a non-array", () => {
    expect(sanitizeWidgetLoadingMessages(["a", "  ", "b", "c", "d", "e"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(sanitizeWidgetLoadingMessages(undefined)).toEqual([]);
  });
});
