import { describe, expect, it } from "vitest";
import { parseSvgIntrinsicSize } from "./svg-intrinsic-size";

describe("parseSvgIntrinsicSize", () => {
  it("prefers explicit width and height", () => {
    expect(parseSvgIntrinsicSize('<svg width="64" height="32" viewBox="0 0 10 10"></svg>')).toEqual(
      {
        width: 64,
        height: 32,
      },
    );
  });

  it("strips a px unit", () => {
    expect(parseSvgIntrinsicSize('<svg width="64px" height="32px"></svg>')).toEqual({
      width: 64,
      height: 32,
    });
  });

  it("falls back to the viewBox when the size is relative", () => {
    expect(parseSvgIntrinsicSize('<svg width="100%" viewBox="0 0 240 120"></svg>')).toEqual({
      width: 240,
      height: 120,
    });
  });

  it("reads a comma-separated viewBox", () => {
    expect(parseSvgIntrinsicSize('<svg viewBox="0,0,240,120"></svg>')).toEqual({
      width: 240,
      height: 120,
    });
  });

  it("has no answer for markup that declares neither", () => {
    expect(parseSvgIntrinsicSize("<svg></svg>")).toBeNull();
    expect(parseSvgIntrinsicSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
    expect(parseSvgIntrinsicSize("not markup at all")).toBeNull();
  });

  it("skips the XML declaration and doctype ahead of the tag", () => {
    const xml = '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg viewBox="0 0 16 16"></svg>';
    expect(parseSvgIntrinsicSize(xml)).toEqual({ width: 16, height: 16 });
  });
});
