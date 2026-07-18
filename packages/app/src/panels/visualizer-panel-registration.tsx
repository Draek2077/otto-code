import { lazy, Suspense } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Waypoints } from "@/components/icons/material-icons";
import { FeatureDisabledPanel } from "@/features/feature-disabled-panel";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";

// The heavy Visualizer panel — the event adapter, the toolbar, the tri-platform
// webview embed, and (transitively) the ~1 MB vendored render bundle — lives
// behind this React.lazy boundary. register-panels.ts imports THIS thin module,
// not visualizer-panel.tsx, so the heavy module is code-split out of the startup
// graph. It is import()-ed only when an enabled Visualizer tab actually renders.
const LazyVisualizerPanel = lazy(() =>
  import("@/panels/visualizer-panel").then((mod) => ({ default: mod.VisualizerPanel })),
);

// The descriptor is intentionally light (a label + the Waypoints glyph) so the
// tab strip can render a Visualizer tab's title/icon without pulling the heavy
// panel module. Kept here, beside the registration, rather than in the panel.
function useVisualizerPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("workspace.visualizer.tabLabel"),
    subtitle: t("workspace.visualizer.subtitle"),
    titleState: "ready",
    icon: Waypoints,
    statusBucket: null,
  };
}

// Host wrapper: the feature flag decides whether the heavy panel is ever
// referenced. While the Visualizer is disabled we render a light placeholder and
// never touch LazyVisualizerPanel, so React.lazy never triggers its import() —
// the render bundle + adapter + toolbar stay entirely out of memory (the "not
// even loaded" guarantee). The Suspense fallback covers the one-time chunk fetch
// on first open when enabled; the panel paints its own opaque load cover after.
function VisualizerFallback() {
  return <View style={styles.fallback} />;
}
// Hoisted once so the Suspense fallback isn't a fresh element per render (and to
// satisfy react-perf's jsx-no-jsx-as-prop).
const VISUALIZER_FALLBACK = <VisualizerFallback />;

function VisualizerPanelHost() {
  const enabled = useFeatureEnabled("visualizer");
  if (!enabled) {
    return <FeatureDisabledPanel featureId="visualizer" />;
  }
  return (
    <Suspense fallback={VISUALIZER_FALLBACK}>
      <LazyVisualizerPanel />
    </Suspense>
  );
}

export const visualizerPanelRegistration: PanelRegistration<"visualizer"> = {
  kind: "visualizer",
  component: VisualizerPanelHost,
  useDescriptor: useVisualizerPanelDescriptor,
  confirmClose() {
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  fallback: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
}));
