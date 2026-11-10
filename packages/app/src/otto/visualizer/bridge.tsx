import { lazy, Suspense } from "react";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
export { activateVisualizerTab } from "./actions";
const Workspace = lazy(async () => ({ default: (await import("./surface")).VisualizerWorkspace }));
const Settings = lazy(async () => ({ default: (await import("./settings")).VisualizerSettings }));
const loading = <SettingsRow label="Loading Visualizer…" />;
export function VisualizerWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Suspense fallback={loading}>
      <Workspace {...props} />
    </Suspense>
  );
}
export function VisualizerSettings() {
  return (
    <Suspense fallback={loading}>
      <Settings />
    </Suspense>
  );
}
