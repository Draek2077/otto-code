import React, { lazy, Suspense, type ReactNode } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Screen = lazy(async () => ({ default: (await import("./screen")).ArtifactsScreen }));
const Workspace = lazy(async () => ({ default: (await import("./screen")).ArtifactsWorkspace }));
const Settings = lazy(async () => ({ default: (await import("./screen")).ArtifactsSettings }));
const loading = <SettingsRow label="Loading Artifacts..." />;
function Available({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoArtifacts): added v0.10.0; remove after 2027-04-29 when host floor >= v0.10.0.
  const available = useHostFeature(hostId, "ottoArtifacts");
  return available ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    <SettingsRow label="Update the host to use Artifacts." />
  );
}
export function ArtifactsScreen(props: PluginScreenProps) {
  return (
    <Available hostId={props.host.id}>
      <Screen {...props} />
    </Available>
  );
}
export function ArtifactsWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Available hostId={props.host.id}>
      <Workspace {...props} />
    </Available>
  );
}
export function ArtifactsSettings(props: PluginSurfaceProps) {
  return (
    <Available hostId={props.host.id}>
      <Settings {...props} />
    </Available>
  );
}
