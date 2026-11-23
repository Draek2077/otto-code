import { expect, it } from "vitest";
import { VisualizerWindowOwner } from "./window-owner";
import { resolveVisualizerAnchor, visualizerAnchor, visualizerPipSize } from "./geometry";
import { VisualizerBridge, prepareVisualizerHtml } from "./transport";
import { visualizerFrame } from "@getpaseo/visualizer/contracts";
it("hands one active guest between tabs and PIP without discarding descriptors", () => {
  const owner = new VisualizerWindowOwner();
  const tab = owner.retain("tab-a", 10);
  expect(owner.getSnapshot()).toBe("tab-a");
  const pip = owner.retain("pip", 100);
  expect(owner.getSnapshot()).toBe("pip");
  const other = owner.retain("tab-b", 10);
  expect(owner.getSnapshot()).toBe("pip");
  pip();
  expect(owner.getSnapshot()).toBe("tab-b");
  other();
  expect(owner.getSnapshot()).toBe("tab-a");
  tab();
  expect(owner.getSnapshot()).toBeNull();
});
it("ignores a stale release for the same restored tab", () => {
  const owner = new VisualizerWindowOwner(),
    old = owner.retain("same", 10),
    current = owner.retain("same", 10);
  old();
  expect(owner.getSnapshot()).toBe("same");
  current();
  expect(owner.getSnapshot()).toBeNull();
});
it("preserves nearest edge insets across window resizes", () => {
  const size = { width: 280, height: 190 };
  const anchor = visualizerAnchor({ x: 700, y: 540 }, { width: 1000, height: 750 }, size);
  expect(anchor).toEqual({ horizontal: "right", vertical: "bottom", x: 20, y: 20 });
  expect(resolveVisualizerAnchor(anchor, { width: 1300, height: 900 }, size)).toEqual({
    x: 1000,
    y: 690,
  });
  expect(resolveVisualizerAnchor(anchor, { width: 100, height: 90 }, size)).toEqual({ x: 0, y: 0 });
});
it("sizes compact PIP within the visible window", () => {
  expect(visualizerPipSize("medium", { width: 320, height: 250 })).toEqual({
    width: 304,
    height: 234,
  });
});
it("accepts only bounded versioned frames for the current guest", () => {
  const messages: unknown[] = [],
    sent: string[] = [];
  const bridge = new VisualizerBridge("channel-1234", (message) => messages.push(message));
  bridge.attach((message) => sent.push(message));
  expect(bridge.send({ type: "viewport-command", action: "restart" })).toBe(false);
  bridge.accept(visualizerFrame("wrong-channel", { type: "ready" }));
  bridge.accept({ type: "ready" });
  bridge.accept("{".repeat(1_000_001));
  expect(messages).toEqual([]);
  bridge.accept(visualizerFrame("channel-1234", { type: "ready" }));
  expect(bridge.send({ type: "viewport-command", action: "restart" })).toBe(true);
  expect(sent).toHaveLength(1);
  bridge.attach(null);
  bridge.accept(visualizerFrame("channel-1234", { type: "ready" }));
  expect(messages).toHaveLength(1);
  expect(bridge.send({ type: "viewport-command", action: "restart" })).toBe(false);
});
it("escapes theme/channel substitution and clamps render scale", () => {
  const html = '"__OTTO_VISUALIZER_CHANNEL__" "__OTTO_DPR_CAP__" "__OTTO_THEME_JSON__"';
  expect(prepareVisualizerHtml(html, "channel-1234", 20, '{"accent":"</script>"}')).not.toContain(
    "</script>",
  );
  expect(() => prepareVisualizerHtml(html, "</script>", 1)).toThrow();
});
