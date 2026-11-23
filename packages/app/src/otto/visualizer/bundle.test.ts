import { expect, it } from "vitest";
import { VISUALIZER_HTML } from "./visualizer-bundle.gen";
import { prepareVisualizerHtml } from "./transport";
import { visualizerFrameDocument } from "./frame-document";
it("ships the real licensed renderer offline within the guest size limit", () => {
  expect(Buffer.byteLength(VISUALIZER_HTML, "utf8")).toBeLessThan(1_500_000);
  expect(VISUALIZER_HTML).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
  expect(VISUALIZER_HTML).toContain("connect-src 'none'");
  expect(VISUALIZER_HTML).toContain("font-src data:");
  expect(VISUALIZER_HTML).toContain("The Inter Project Authors");
  expect(VISUALIZER_HTML).toContain("The JetBrains Mono Project Authors");
  expect(VISUALIZER_HTML).toContain("SIL Open Font License");
  expect(VISUALIZER_HTML).not.toContain("EventSource");
  expect(VISUALIZER_HTML).not.toContain("http://127.0.0.1");
  expect(VISUALIZER_HTML.match(/"__OTTO_VISUALIZER_CHANNEL__"/gu)).toHaveLength(1);
  expect(prepareVisualizerHtml(VISUALIZER_HTML, "fixture-channel", 1.5)).toContain(
    'window.__OTTO_VISUALIZER_CHANNEL__="fixture-channel"',
  );
});
it("keeps navigation and cross-frame transport under the parent policy", () => {
  const html = visualizerFrameDocument(
    '<script>window.location="https://example.invalid"</script>',
  );
  expect(html).toContain("frame-src about:");
  expect(html).toContain('title="Visualizer content" sandbox="allow-scripts"');
  expect(html).not.toContain("allow-same-origin");
  expect(html).toContain("event.source===guest.contentWindow");
});
