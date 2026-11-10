import type { VisualizerConfig } from "@getpaseo/visualizer/contracts";
import { selectedVisualizerSidePanel, type VisualizerPreferences } from "./preferences";
export function visualizerConfig(
  preferences: VisualizerPreferences,
  placement: "tab" | "pip" | "background",
  latestBubble = false,
): VisualizerConfig {
  const compact = placement !== "tab";
  const sidePanel = compact ? undefined : selectedVisualizerSidePanel(preferences);
  return {
    showMockData: false,
    paused: false,
    panels: {
      timeline: !compact && preferences.visualizerPanelTimeline,
      fileAttention: sidePanel === "visualizerPanelFileAttention",
      costOverlay: sidePanel === "visualizerPanelCostOverlay",
      failures: sidePanel === "visualizerPanelFailures",
      stats: !compact && preferences.visualizerPanelStats,
    },
    render: {
      bloom: preferences.visualizerRenderBloom,
      nodeGlow: preferences.visualizerRenderNodeGlow,
      stars: preferences.visualizerRenderStars,
      backdrop: preferences.visualizerRenderBackdrop,
      showFps: preferences.visualizerShowFps,
      nodeShape: preferences.visualizerNodeShape,
      contextDisplay: preferences.visualizerContextDisplay,
    },
    soundVolume: preferences.visualizerSoundMuted ? 0 : preferences.visualizerSoundVolume / 100,
    hudHidden: placement === "background" || preferences.visualizerHudHidden,
    hudBottomHidden: compact,
    hudCompact: placement === "pip",
    showLatestAssistantBubble: placement === "background" && latestBubble,
    camera:
      placement === "pip"
        ? { viewportPadding: 24, autoFitMaxScale: 0.7 }
        : { viewportPadding: 80, autoFitMaxScale: 1.2 },
  };
}
