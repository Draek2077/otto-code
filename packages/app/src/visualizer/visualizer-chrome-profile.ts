// Per-surface chrome + framing profiles for the Visualizer guest.
//
// The guest page is a config-driven follower (docs/visualizer.md): the host
// decides what HUD it shows and how the camera frames the graph. The TAB and
// the PIP want different answers to both questions, and those answers are the
// only real difference between the two surfaces — everything else (the
// simulation, the adapter, the theme, the fonts) is identical. Keeping the
// divergence in one small data module is what stops PIP from becoming a second
// forked copy of the panel.
import type { VisualizerPipSize } from "@/hooks/use-settings/storage";

/** Which Visualizer surface a guest is rendering into. */
export type VisualizerSurfaceKind = "tab" | "pip";

/**
 * PIP auto-fit framing (vendor `config.camera`, OTTO PATCH — see
 * vendor/agent-flow/OTTO-PATCHES.md 2026-07-20).
 *
 * The tab's constants (`ANIM.viewportPadding` 56, `AUTOFIT_MAX_SCALE` 3.2) were
 * retuned 2026-07-20 for a full-tab viewport and read wrong in a ~260x160 box
 * in both directions:
 *
 * - `viewportPadding` is world-unit margin added on EACH side of the fitted
 *   bounds. At 56 it is a modest frame around a big graph in a big viewport; in
 *   a PIP it is most of the usable area, so every node shrinks to a dot. 16 is
 *   about the same *proportion* of frame the tab gets.
 * - `autoFitMaxScale` 3.2 exists so a large graph isn't clamped small. In a PIP
 *   the opposite risk dominates: a one- or two-node graph zooms until the nodes
 *   overflow their own frame. 1.6 keeps a small graph readable without letting
 *   it burst the box.
 *
 * Deliberately NOT sent by the tab — an absent `camera` key keeps the vendor
 * defaults, so this profile can be tuned without touching tab framing.
 */
export const PIP_CAMERA_FRAMING = {
  viewportPadding: 16,
  autoFitMaxScale: 1.6,
} as const;

/** PIP viewport sizes, in px. Small is a glance; medium is watchable. 16:10 —
 * the graph spreads horizontally (parent → children), so a wide box wastes less
 * of the fit than a square one. */
export const PIP_DIMENSIONS: Record<VisualizerPipSize, { width: number; height: number }> = {
  small: { width: 240, height: 150 },
  medium: { width: 384, height: 240 },
};

/**
 * How faded the PIP goes while the pointer is over it, so you can read the
 * workspace THROUGH it (charter: "hover makes it transparent").
 *
 * This has to be applied to the whole frame — background, border and guest
 * together — not just the guest. Fading only the guest composites it against
 * the frame's own opaque surface color, which reads as "pale grey rectangle"
 * rather than transparency: you see a washed-out PIP, not the chat behind it.
 * The control strip is a SIBLING of the faded frame, not a child, so it stays
 * fully opaque and usable while everything under it goes see-through.
 *
 * Tuned by eye against the chat underneath. 0.12 was too aggressive — the PIP
 * effectively vanished, so you lost track of what you were hovering. The value
 * has to stay low enough that chat text stays readable through it; this is the
 * balance point, not a round number to nudge freely.
 */
export const PIP_HOVER_OPACITY = 0.3;

export interface VisualizerChromeProfile {
  /** Whole-HUD collapse — the tab's HUD-eye setting. */
  hudHidden: boolean;
  /** Bottom play/scrubber bar only (vendor `config.hudBottomHidden`, OTTO
   * PATCH). PIP is "top HUD, nothing else": a glanceable viewport, not an
   * interactive surface, so it has no transport controls at all. */
  hudBottomHidden: boolean;
  /** Compact HUD layout (vendor `config.hudCompact`, OTTO PATCH). The PIP keeps
   * the stats readout but can't afford the tab's single top-right block — at
   * 240px wide it wraps to two lines over the graph. Compact splits it across
   * both top corners ("N agents" left, tokens right) and drops the FPS meter to
   * the bottom-left, out of the corner the agent count now owns. */
  hudCompact: boolean;
  /** Slide-in informational panels. All off in PIP — there is no room, and the
   * charter is explicit that PIP carries no options and no controls. */
  panelsEnabled: boolean;
  /** Auto-fit framing override; absent keeps the vendor's tab-tuned values. */
  camera?: { viewportPadding: number; autoFitMaxScale: number };
}

export function resolveVisualizerChromeProfile(input: {
  surface: VisualizerSurfaceKind;
  /** The device-local HUD-eye setting (tab only). */
  hudHidden: boolean;
}): VisualizerChromeProfile {
  if (input.surface === "pip") {
    return {
      // The top stats readout is the ONE piece of HUD PIP keeps — it is the
      // whole informational payload at this size (agent count + tokens).
      hudHidden: false,
      hudBottomHidden: true,
      hudCompact: true,
      panelsEnabled: false,
      camera: { ...PIP_CAMERA_FRAMING },
    };
  }
  return {
    hudHidden: input.hudHidden,
    hudBottomHidden: false,
    hudCompact: false,
    // Hiding the HUD hides the slide-in panels too — see docs/visualizer.md
    // "config.hudHidden": the eye is meant to give a genuinely clean canvas.
    panelsEnabled: !input.hudHidden,
  };
}
