import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// A dismissed card has to start its exit from where it was standing. That only
// means anything with real layout, so this runs in a browser: the fan is
// bottom-anchored above the message box, and the regression it guards against
// was the card being drawn somewhere else entirely for the first frame of its
// exit — high above the composer — before fading and sinking from there.
//
// Reanimated's web exit did that, which is why this component no longer uses it:
// it pins an absolutely-positioned clone at coordinates snapshotted at the
// card's last React render, so any layout drift since (a window resize, a
// splitter drag) lands as a jump. The last case here is exactly that drift.

vi.mock("@/hooks/use-animations-enabled", () => ({
  useAnimationsEnabled: () => animationsEnabled,
}));

let animationsEnabled = true;

const { ComposerTrackTransition, COMPOSER_TRACK_LAYERS } = await import("./track-transition");

const BAND_HEIGHT = 48;
const TUCK = 16;
const PANE_HEIGHT = 600;
const COMPOSER_HEIGHT = 80;
const TRACKS = 3;

const PANE_STYLE = { height: PANE_HEIGHT, display: "flex", flexDirection: "column" } as const;
const TRANSCRIPT_STYLE = { flex: "1 1 0%" } as const;
const INPUT_AREA_STYLE = { position: "relative", width: "100%" } as const;
const COMPOSER_STYLE = {
  position: "relative",
  zIndex: COMPOSER_TRACK_LAYERS.composer,
  height: COMPOSER_HEIGHT,
} as const;
const BAND_OUTER_STYLE = { width: "100%", position: "relative" } as const;
const BAND_TRACK_STYLE = { marginBottom: -TUCK, position: "relative" } as const;
const BAND_SURFACE_STYLE = { height: BAND_HEIGHT } as const;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];

afterEach(() => {
  animationsEnabled = true;
  while (mounted.length > 0) {
    const entry = mounted.pop();
    act(() => entry?.root.unmount());
    entry?.host.remove();
  }
});

function Band({ index }: { index: number }): React.JSX.Element {
  // Mirrors FlyoutBand's geometry: the band tucks its bottom edge behind the
  // message box with a negative margin, so its box is shorter than it is.
  return (
    <div style={BAND_OUTER_STYLE}>
      <div style={BAND_TRACK_STYLE}>
        <div data-band={index} style={BAND_SURFACE_STYLE}>
          band {index}
        </div>
      </div>
    </div>
  );
}

function Harness({ bands }: { bands: number }): React.JSX.Element {
  return (
    <div id="pane" style={PANE_STYLE}>
      {/* The transcript takes the slack, so the input area is bottom-anchored
          and anything that resizes the pane moves every card in the viewport. */}
      <div style={TRANSCRIPT_STYLE} />
      <div id="input-area" style={INPUT_AREA_STYLE}>
        {/* Like the real tracks: the wrapper stays mounted and an empty render
            is how a card is dismissed. */}
        {Array.from({ length: TRACKS }, (_, index) => (
          <ComposerTrackTransition key={index} layer={COMPOSER_TRACK_LAYERS.contextHealth + index}>
            {index < bands ? <Band index={index} /> : null}
          </ComposerTrackTransition>
        ))}
        <div style={COMPOSER_STYLE} />
      </div>
    </div>
  );
}

function mountHarness(bands: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let setBands: (next: number) => void = () => {};
  function Controlled() {
    const [count, set] = useState(bands);
    setBands = set;
    return <Harness bands={count} />;
  }
  act(() => root.render(<Controlled />));
  mounted.push({ root, host });
  return {
    host,
    show: (next: number) => act(() => setBands(next)),
    bandTop: (index: number) =>
      host.querySelector(`[data-band="${index}"]`)?.getBoundingClientRect().top ?? null,
    bandCount: () => host.querySelectorAll("[data-band]").length,
    /** Reanimated's exit clone, if this ever regresses to using one. */
    clones: () =>
      Array.from(host.querySelector("#input-area")?.children ?? []).filter(
        (child) => (child as HTMLElement).style.position === "absolute",
      ).length,
  };
}

/** Lets the entrance finish so a dismissal starts from a settled card. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

describe("composer track dismissal", () => {
  it("starts the exit from where the only band was standing", async () => {
    const harness = mountHarness(1);
    await settle();
    const before = harness.bandTop(0);

    harness.show(0);

    expect(harness.bandTop(0)).toBe(before);
    expect(harness.clones()).toBe(0);
  });

  it("starts the exit in place when bands are stacked", async () => {
    const harness = mountHarness(3);
    await settle();
    const before = harness.bandTop(2);

    harness.show(2);

    expect(harness.bandTop(2)).toBe(before);
  });

  it("starts the exit in place after the pane resized under it", async () => {
    // A window resize, a splitter drag or a sidebar toggle moves the whole
    // bottom-anchored input area without re-rendering the band. This is the
    // case that used to throw the card the full height of the resize.
    const harness = mountHarness(1);
    await settle();
    const pane = harness.host.querySelector("#pane") as HTMLElement;
    pane.style.height = `${PANE_HEIGHT + 120}px`;
    const before = harness.bandTop(0);

    harness.show(0);

    expect(harness.bandTop(0)).toBe(before);
  });

  it("sinks the band downward as it leaves, never upward", async () => {
    const harness = mountHarness(1);
    await settle();
    const before = harness.bandTop(0) ?? 0;

    harness.show(0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const during = harness.bandTop(0);
    expect(during).not.toBeNull();
    expect(during ?? 0).toBeGreaterThan(before);
  });

  it("removes the band once the exit is over", async () => {
    const harness = mountHarness(1);
    await settle();

    harness.show(0);
    await settle();

    expect(harness.bandCount()).toBe(0);
  });

  it("mounts and unmounts instantly with animations off", async () => {
    animationsEnabled = false;
    const harness = mountHarness(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(harness.bandCount()).toBe(1);

    harness.show(0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(harness.bandCount()).toBe(0);
  });
});
