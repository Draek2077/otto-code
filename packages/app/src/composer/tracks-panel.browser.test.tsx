import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerTrackPill, ComposerTrackRow, type ComposerTrackPillSegment } from "./tracks";

const SUBAGENT_SEGMENTS: ComposerTrackPillSegment[] = [{ bucket: null, text: "3 subagents" }];

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * The real menu engine, in a real browser, because both things under test only exist there: the
 * panel's dismissal runs through `selectItem`, and the running mark is a Web Animations rotation
 * that jsdom cannot report.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

function pill(): HTMLElement {
  const trigger = document.querySelector('[data-testid="pill"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("track pill did not render");
  }
  return trigger;
}

function openPanel(): void {
  click(pill());
}

function row(testID: string): Element | null {
  return document.querySelector(`[data-testid="${testID}"]`);
}

function isPanelOpen(): boolean {
  return pill().getAttribute("aria-expanded") === "true";
}

describe("composer track panel", () => {
  it("dismisses itself when a row is chosen", () => {
    const onPress = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow accessibilityLabel="Subagent one" testID="row" onPress={onPress}>
          <Text>Subagent one</Text>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    const target = row("row");
    expect(target).not.toBeNull();

    click(target as Element);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isPanelOpen()).toBe(false);
    expect(row("row")).toBeNull();
  });

  it("stays open for a row whose result lands in the panel", () => {
    const onPress = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow
          accessibilityLabel="Archive finished"
          testID="row"
          closeOnSelect={false}
          onPress={onPress}
        >
          <Text>Archive finished</Text>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    click(row("row") as Element);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isPanelOpen()).toBe(true);
    expect(row("row")).not.toBeNull();
  });

  it("leaves the panel alone when a row's own action button is pressed", () => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow accessibilityLabel="Subagent one" testID="row" onPress={onPress}>
          <Text>Subagent one</Text>
          <Pressable accessibilityRole="button" testID="row-archive" onPress={onAction}>
            <Text>Archive</Text>
          </Pressable>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    click(row("row-archive") as Element);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(isPanelOpen()).toBe(true);
  });
});

describe("composer track pill status mark", () => {
  /** The mark is the glyph itself: the dot for a still state, the ring's carrier for running. */
  function mountMark(bucket: "running" | "failed"): { mark: HTMLElement; body: HTMLElement } {
    const container = mount(
      <ComposerTrackPill
        testID="pill"
        segments={[{ bucket, text: "3 subagents" }]}
        panelTitle="Subagents"
      >
        <Text>rows</Text>
      </ComposerTrackPill>,
    );
    const segment = container.querySelector('[data-testid="pill-segment-0"]');
    const body = container.querySelector('[data-testid="pill"]');
    if (!(segment?.firstElementChild instanceof HTMLElement) || !(body instanceof HTMLElement)) {
      throw new Error("pill did not render a status mark");
    }
    return { mark: segment.firstElementChild, body };
  }

  it("mounts the shared status ring while a child is running", () => {
    const { mark } = mountMark("running");
    // The ring is the shared StatusRing frame (a ring layer around a center
    // dot), not a dot of its own. Its motion is the plasma spinner's, which
    // is not a DOM animation this harness can count, so presence and shape
    // are what is asserted here.
    const frame = mark.firstElementChild;
    if (!(frame instanceof HTMLElement)) {
      throw new Error("running mark did not render the status ring frame");
    }
    expect(frame.childElementCount).toBeGreaterThanOrEqual(2);
    expect(mark.querySelector("[data-testid='track-status-dot']")).toBeNull();
  });

  it("draws a still dot for every other state", () => {
    const { mark } = mountMark("failed");
    const animated = [...mark.querySelectorAll("*")].filter(
      (element) => element.getAnimations().length > 0,
    );

    expect(animated).toHaveLength(0);
    // Semantic danger, the same token the sidebar status dots use.
    expect(getComputedStyle(mark).backgroundColor).toBe("rgb(185, 28, 28)");
  });

  it("starts the circle you can see on the pill's own padding, whatever the state", () => {
    // The inset the eye compares a leading mark against is the label's trailing one, and that one
    // is the pill's padding. A mark boxed wider than its glyph sits further in than that while
    // looking correctly centred in the box nobody can see.
    for (const bucket of ["running", "failed"] as const) {
      const { mark, body } = mountMark(bucket);
      // The dot is its own box; the ring is drawn by the rotator inside the frame's halo.
      const glyph = bucket === "failed" ? mark : mark.firstElementChild?.firstElementChild;
      if (!(glyph instanceof HTMLElement)) {
        throw new Error(`${bucket} mark did not render a glyph`);
      }

      const style = getComputedStyle(body);
      const edge = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
      const inset = glyph.getBoundingClientRect().left - body.getBoundingClientRect().left;

      // The ring keeps a one-pixel halo (STATUS_RING_HALO_INSET) that the
      // mark trims with a negative margin; the visible circle may sit one
      // pixel either side of the padding edge, never more.
      expect(Math.abs(inset - edge)).toBeLessThanOrEqual(1);
    }
  });

  it("draws every state it is given, so a running child survives a failed sibling", () => {
    const container = mount(
      <ComposerTrackPill
        testID="pill"
        segments={[
          { bucket: "failed", text: "1 failed" },
          { bucket: "running", text: "1 working" },
        ]}
        panelTitle="Subagents"
      >
        <Text>rows</Text>
      </ComposerTrackPill>,
    );

    const segments = [...container.querySelectorAll('[data-testid^="pill-segment-"]')];
    expect(segments.map((segment) => segment.textContent)).toEqual(["1 failed", "1 working"]);
    // The running segment carries the shared ring frame (ring layer plus center
    // dot) where the failed one carries a bare dot, so the frame's presence
    // proves the second state survived.
    const runningMark = segments[1]?.firstElementChild?.firstElementChild;
    expect(runningMark instanceof HTMLElement && runningMark.childElementCount >= 2).toBe(true);
    const failedMark = segments[0]?.firstElementChild;
    expect(failedMark instanceof HTMLElement && failedMark.childElementCount).toBe(0);
  });
});
