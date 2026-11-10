import React, { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { queryClient } from "@/data/query-client";
export async function activateVisualizerTab() {
  const actions = await import("./actions");
  return actions.activateVisualizerTab();
}
const Workspace = lazy(async () => ({ default: (await import("./surface")).VisualizerWorkspace }));
const Settings = lazy(async () => ({ default: (await import("./settings")).VisualizerSettings }));
export function VisualizerWorkspace(props: PluginWorkspacePanelProps) {
  return (
    // Plugin RPC caches remain installation-owned. These app-owned controls
    // instead share the same device preferences as the header/window/background.
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Workspace {...props} />
      </Suspense>
    </QueryClientProvider>
  );
}
export function VisualizerSettings() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}
