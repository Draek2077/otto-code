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

  it("shortens a Windows home directory path", () => {
    expect(shortenPath("C:\\Users\\devuser\\dev\\otto")).toBe("~\\dev\\otto");
    expect(shortenPath("D:/Users/devuser/dev/otto")).toBe("~/dev/otto");
  });

  it("leaves a Windows path outside the user profile unchanged", () => {
    expect(shortenPath("C:\\Program Files\\otto")).toBe("C:\\Program Files\\otto");
  });

  it("returns an empty string for null or undefined", () => {
    expect(shortenPath(null)).toBe("");
    expect(shortenPath(undefined)).toBe("");
  });

  it("returns an empty string for an empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});
