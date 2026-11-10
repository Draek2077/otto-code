import { z } from "zod";

// Exact 0.9 device keys. This is persistence normalization, never a wire schema.
export const visualizerPreferenceDefaults = {
  visualizerPanelTimeline: false,
  visualizerPanelFileAttention: false,
  visualizerPanelCostOverlay: false,
  visualizerPanelFailures: false,
  visualizerPanelStats: false,
  visualizerRenderBloom: false,
  visualizerRenderNodeGlow: true,
  visualizerRenderStars: true,
  visualizerRenderBackdrop: true,
  visualizerRenderQuality: "sharp" as "performance" | "balanced" | "sharp" | "native",
  visualizerShowFps: false,
  visualizerNodeShape: "circle" as "square" | "hexagon" | "octagon" | "circle",
  visualizerContextDisplay: "ring" as "ring" | "bar",
  visualizerSoundVolume: 50,
  visualizerSoundMuted: false,
  visualizerHudHidden: false,
  visualizerPipOpen: false,
  visualizerBackgroundOpen: false,
  visualizerSurface: "tab" as "tab" | "pip" | "background",
  visualizerPipSize: "small" as "small" | "medium",
  visualizerPipX: 1,
  visualizerPipY: 0,
};
export type VisualizerPreferences = typeof visualizerPreferenceDefaults;
export function visualizerPlacement(preferences: VisualizerPreferences) {
  // COMPAT(visualizerPlacement): added v0.10.0; remove conflict precedence after
  // 2027-05-10 when the supported floor no longer writes 0.9's independent flags.
  if (preferences.visualizerSurface === "background" && preferences.visualizerBackgroundOpen)
    return "background";
  if (preferences.visualizerPipOpen) return "pip";
  if (preferences.visualizerBackgroundOpen) return "background";
  return "tab";
}
export const visualizerStoredPreferences = {
  visualizerPanelTimeline: z.boolean().catch(false),
  visualizerPanelFileAttention: z.boolean().catch(false),
  visualizerPanelCostOverlay: z.boolean().catch(false),
  visualizerPanelFailures: z.boolean().catch(false),
  visualizerPanelStats: z.boolean().catch(false),
  visualizerRenderBloom: z.boolean().catch(false),
  visualizerRenderNodeGlow: z.boolean().catch(true),
  visualizerRenderStars: z.boolean().catch(true),
  visualizerRenderBackdrop: z.boolean().catch(true),
  visualizerRenderQuality: z.enum(["performance", "balanced", "sharp", "native"]).catch("sharp"),
  visualizerShowFps: z.boolean().catch(false),
  visualizerNodeShape: z.enum(["square", "hexagon", "octagon", "circle"]).catch("circle"),
  visualizerContextDisplay: z.enum(["ring", "bar"]).catch("ring"),
  visualizerSoundVolume: z.number().finite().min(0).max(100).catch(50),
  visualizerSoundMuted: z.boolean().catch(false),
  visualizerHudHidden: z.boolean().catch(false),
  visualizerPipOpen: z.boolean().catch(false),
  visualizerBackgroundOpen: z.boolean().catch(false),
  visualizerSurface: z.enum(["tab", "pip", "background"]).catch("tab"),
  visualizerPipSize: z.enum(["small", "medium"]).catch("small"),
  visualizerPipX: z.number().finite().min(0).max(1).catch(1),
  visualizerPipY: z.number().finite().min(0).max(1).catch(0),
};
export const visualizerRenderScale = { performance: 1, balanced: 1.25, sharp: 1.5, native: 4 };
