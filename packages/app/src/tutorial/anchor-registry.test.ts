import { describe, expect, it, vi } from "vitest";
import {
  getTutorialAnchorNode,
  registerTutorialAnchor,
  subscribeTutorialAnchor,
  type MeasurableNode,
} from "./anchor-registry";

function fakeNode(): MeasurableNode {
  return { measureInWindow: () => {} };
}

describe("anchor registry", () => {
  it("stores and returns the registered node, and clears it on null", () => {
    const node = fakeNode();
    registerTutorialAnchor("settings", node);
    expect(getTutorialAnchorNode("settings")).toBe(node);

    registerTutorialAnchor("settings", null);
    expect(getTutorialAnchorNode("settings")).toBeNull();
  });

  it("notifies subscribers on register and unregister, and stops after unsubscribe", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeTutorialAnchor("explorer-toggle", cb);

    registerTutorialAnchor("explorer-toggle", fakeNode());
    registerTutorialAnchor("explorer-toggle", null);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    registerTutorialAnchor("explorer-toggle", fakeNode());
    expect(cb).toHaveBeenCalledTimes(2);

    registerTutorialAnchor("explorer-toggle", null);
  });

  it("keeps anchor ids independent", () => {
    const settings = fakeNode();
    const chat = fakeNode();
    registerTutorialAnchor("settings", settings);
    registerTutorialAnchor("chat-input", chat);

    expect(getTutorialAnchorNode("settings")).toBe(settings);
    expect(getTutorialAnchorNode("chat-input")).toBe(chat);

    registerTutorialAnchor("settings", null);
    registerTutorialAnchor("chat-input", null);
  });
});
