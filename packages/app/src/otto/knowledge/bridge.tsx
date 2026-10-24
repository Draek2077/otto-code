import React, { lazy, Suspense } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";

// Registry/evaluator imports must stay usable without browser-only Markdown/WASM.
// The operational surface is loaded only after the built-in is actually opened.
const Workspace = lazy(async () => ({
  default: (await import("./plugin-ui")).ProjectKnowledgeWorkspace,
}));
const Screen = lazy(async () => ({
  default: (await import("./plugin-ui")).ProjectKnowledgeScreen,
}));
const Settings = lazy(async () => ({
  default: (await import("./plugin-ui")).ProjectKnowledgeSettings,
}));
const loading = <SettingsRow label="Loading Project Knowledge..." />;
export function ProjectKnowledgeWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Suspense fallback={loading}>
      <Workspace {...props} />
    </Suspense>
  );
}
export function ProjectKnowledgeScreen(props: PluginScreenProps) {
  return (
    <Suspense fallback={loading}>
      <Screen {...props} />
    </Suspense>
  );
}
export function ProjectKnowledgeSettings(props: PluginSurfaceProps) {
  return (
    <Suspense fallback={loading}>
      <Settings {...props} />
    </Suspense>
  );
}
