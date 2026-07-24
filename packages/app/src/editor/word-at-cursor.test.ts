import { describe, expect, test } from "vitest";
import { findWordAtCursor } from "./word-at-cursor";

// `column` is 1-based, so the caret sits before `lineText[column - 1]`. The
// comments below mark the caret with `|`.

describe("findWordAtCursor", () => {
  test("reads the identifier the caret sits inside", () => {
    // const wid|get = 1
    expect(findWordAtCursor("const widget = 1", 10)).toBe("widget");
  });

  test("reads the identifier the caret sits at the start of", () => {
    // const |widget = 1
    expect(findWordAtCursor("const widget = 1", 7)).toBe("widget");
  });

  test("reads the identifier the caret sits at the end of", () => {
    // const widget| = 1
    expect(findWordAtCursor("const widget = 1", 13)).toBe("widget");
  });

  test("reads the member name, not the receiver, when the caret is past the dot", () => {
    // store.get|State()
    expect(findWordAtCursor("store.getState()", 10)).toBe("getState");
  });

  test("prefers the word to the right when the caret is between two words", () => {
    // store.|getState()
    expect(findWordAtCursor("store.getState()", 7)).toBe("getState");
  });

  test("treats $ and _ as word characters and - as a separator", () => {
    expect(findWordAtCursor("const $_cache = 1", 9)).toBe("$_cache");
    // data-tes|tid
    expect(findWordAtCursor("data-testid", 9)).toBe("testid");
  });

  test("returns empty when the caret is in whitespace between words", () => {
    // const widget =| 1  → the caret is on "=", with spaces either side
    expect(findWordAtCursor("const widget = 1", 15)).toBe("");
  });

  test("returns empty for punctuation with no adjacent word", () => {
    expect(findWordAtCursor("  { }  ", 4)).toBe("");
  });

  test("returns empty for a number literal", () => {
    // const count = 12|34
    expect(findWordAtCursor("const count = 1234", 17)).toBe("");
  });

  test("returns empty for an empty line", () => {
    expect(findWordAtCursor("", 1)).toBe("");
  });

  test("clamps a column past the end of the line", () => {
    expect(findWordAtCursor("widget", 99)).toBe("widget");
  });

  test("clamps a column before the start of the line", () => {
    expect(findWordAtCursor("widget", 0)).toBe("widget");
  });
});
