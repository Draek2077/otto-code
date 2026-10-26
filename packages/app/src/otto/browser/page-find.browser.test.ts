import { afterEach, beforeEach, expect, it } from "vitest";
import { buildPageFindScript, type PageFindRequest, type PageFindResult } from "./page-find";

let frame: HTMLIFrameElement;
const defaults: PageFindRequest = {
  query: "cafe",
  matchCase: false,
  matchDiacritics: false,
  wholeWords: false,
  highlightAll: true,
  direction: 0,
};
beforeEach(async () => {
  frame = document.createElement("iframe");
  frame.style.cssText = "width:600px;height:400px";
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.srcdoc =
    '<p>Café cafe CAFÉ cafeteria</p><p>decomposed cafe\u0301</p><p>across <b>inline</b> text</p><p hidden>cafe</p><script>"cafe"</script>';
  document.body.appendChild(frame);
  await loaded;
});
afterEach(() => frame.remove());
function find(overrides: Partial<PageFindRequest> = {}): PageFindResult {
  return (frame.contentWindow as Window & { eval: (code: string) => PageFindResult }).eval(
    buildPageFindScript({ ...defaults, ...overrides }),
  );
}
it("finds visible text with case, canonical accents and whole-word matching", () => {
  expect(find()).toEqual({ current: 1, total: 5, limited: false });
  expect(find({ wholeWords: true }).total).toBe(4);
  expect(find({ query: "café", matchDiacritics: true }).total).toBe(3);
  expect(find({ query: "Café", matchCase: true, matchDiacritics: true }).total).toBe(1);
  expect(find({ query: "across inline text" }).total).toBe(1);
  expect(find({ query: "text cafe" }).total).toBe(0);
});
it("wraps both directions, highlights all optionally and clears without changing page text", () => {
  const text = frame.contentDocument!.body.innerHTML;
  expect(find().current).toBe(1);
  expect(find({ direction: -1 }).current).toBe(5);
  expect(find({ direction: 1 }).current).toBe(1);
  const highlights = (
    frame.contentWindow as unknown as { CSS: { highlights: Map<string, { size: number }> } }
  ).CSS.highlights;
  expect(highlights.get("otto-page-find-all")?.size).toBe(5);
  find({ highlightAll: false });
  expect(highlights.has("otto-page-find-all")).toBe(false);
  expect(highlights.get("otto-page-find-active")?.size).toBe(1);
  find({ query: "" });
  expect(highlights.has("otto-page-find-active")).toBe(false);
  expect(frame.contentDocument!.body.innerHTML).toBe(text);
});

it("matches rendered whitespace and normalizes Greek case consistently", () => {
  frame.contentDocument!.body.innerHTML = "<p>wrapped\n   words</p><p>ΟΣ ος</p>";
  expect(find({ query: "wrapped words" }).total).toBe(1);
  expect(find({ query: "ΟΣ" }).total).toBe(2);
});
