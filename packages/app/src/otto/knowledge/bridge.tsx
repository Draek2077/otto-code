import React, { lazy, Suspense, type ReactNode } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";

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
const loading = <SettingsRow label="Loading Knowledge..." />;
function Available({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoKnowledge): added v0.10.0; remove after 2027-04-25 when host floor >= v0.10.0.
  const available = useHostFeature(hostId, "ottoKnowledge");
  return available ? children : <SettingsRow label="Update the host to use Knowledge." />;
}
export function ProjectKnowledgeWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Available hostId={props.host.id}>
      <Suspense fallback={loading}>
        <Workspace {...props} />
      </Suspense>
    </Available>
  );
}
export function ProjectKnowledgeScreen(props: PluginScreenProps) {
  return (
    <Available hostId={props.host.id}>
      <Suspense fallback={loading}>
        <Screen {...props} />
      </Suspense>
    </Available>
  );
}
export function ProjectKnowledgeSettings(props: PluginSurfaceProps) {
  return (
    <Available hostId={props.host.id}>
      <Suspense fallback={loading}>
        <Settings {...props} />
      </Suspense>
    </Available>
  );
}

export { ContextManagementWorkspace, ContextManagementScreen } from "../context-management/bridge";
