import { describe, expect, it } from "vitest";
import { isMermaidWebviewAttach } from "./mermaid-webview";

describe("isMermaidWebviewAttach", () => {
  it("matches only Mermaid's private partition on a self-contained document", () => {
    expect(
      isMermaidWebviewAttach({
        partition: "otto-mermaid-runtime",
        src: "data:text/html;charset=utf-8,x",
      }),
    ).toBe(true);
    expect(
      isMermaidWebviewAttach({
        partition: "otto-artifact-preview",
        src: "data:text/html;charset=utf-8,x",
      }),
    ).toBe(false);
    expect(
      isMermaidWebviewAttach({ partition: "otto-mermaid-runtime", src: "https://example.test" }),
    ).toBe(false);
  });
});
