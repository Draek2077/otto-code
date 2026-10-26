import React, { lazy, Suspense } from "react";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Workspace = lazy(async () => ({ default: (await import("./screen")).PreviewWorkspace }));
const loading = <SettingsRow label="Loading Preview servers..." />;
export function PreviewWorkspace(props: PluginWorkspacePanelProps) {
  // COMPAT(ottoPreview): added v0.10.0; remove after 2027-04-26 when host floor >= v0.10.0.
  const available = useHostFeature(props.host.id, "ottoPreview");
  return available ? (
    <Suspense fallback={loading}>
      <Workspace key={`${props.host.id}/${props.workspaceId}`} {...props} />
    </Suspense>
  ) : (
    <SettingsRow label="Update the host to use Preview servers." />
  );
}
