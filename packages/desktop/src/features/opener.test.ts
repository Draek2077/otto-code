import { describe, expect, it } from "vitest";

import { createExternalUrlOpener } from "./opener";

describe("desktop opener", () => {
  it("allows the existing HTTP(S) destinations and rejects Otto and unsafe schemes", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });
    await open("https://example.com/path");
    await open("http://localhost:8081");
    expect(opened).toEqual(["https://example.com/path", "http://localhost:8081/"]);
    for (const candidate of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "otto://settings",
      "/relative/path",
      null,
    ]) {
      await expect(open(candidate)).rejects.toThrow("Only HTTP(S) URLs can open externally.");
    }
    expect(opened).toHaveLength(2);
  });

  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("does not hand non-web or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow("Only HTTP(S) URLs can open externally.");
    }

    expect(opened).toEqual([]);
  });
});
