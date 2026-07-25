import { describe, expect, it } from "vitest";
import { shortenPath } from "./shorten-path";

describe("shortenPath", () => {
  it("shortens a macOS home directory path", () => {
    expect(shortenPath("/Users/devuser/dev/otto")).toBe("~/dev/otto");
  });

  it("shortens a Linux home directory path", () => {
    expect(shortenPath("/home/devuser/dev/otto")).toBe("~/dev/otto");
  });

  it("leaves non-home absolute paths unchanged", () => {
    expect(shortenPath("/var/www/app")).toBe("/var/www/app");
  });

  it("leaves Windows paths unchanged", () => {
    expect(shortenPath("C:\\Users\\devuser\\dev\\otto")).toBe("C:\\Users\\devuser\\dev\\otto");
  });

  it("returns an empty string for null or undefined", () => {
    expect(shortenPath(null)).toBe("");
    expect(shortenPath(undefined)).toBe("");
  });

  it("returns an empty string for an empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});
