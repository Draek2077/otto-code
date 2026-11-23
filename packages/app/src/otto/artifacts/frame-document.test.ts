// @vitest-environment jsdom
import { expect, test } from "vitest";
import { artifactFrameDocument } from "./frame-document";
test.each([
  "<html><head></head><body><button onclick=\"this.textContent='Done'\">Run</button></body></html>",
  '"><script>parent.document.body.dataset.escape="bad"</script>&amp;\n</iframe>',
  '<html><head></head><body>Unicode: déjà vu & "quotes"</body></html>',
])(
  "untrusted markup remains exactly one opaque child document and cannot alter its embedding policy",
  (html) => {
    const document = new DOMParser().parseFromString(artifactFrameDocument(html), "text/html");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toBe(html);
    expect(document.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(document.querySelector("meta")?.getAttribute("content")).toContain("frame-src about:");
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.querySelector("script")?.textContent).not.toContain("dataset.escape");
  },
);
