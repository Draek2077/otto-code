import React, { lazy, Suspense, type ReactNode } from "react";
import type { PluginWorkspacePanelProps, PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Workspace = lazy(async () => ({
  default: (await import("./screen")).ContextManagementWorkspace,
}));
const Screen = lazy(async () => ({ default: (await import("./screen")).ContextManagementScreen }));
const loading = <SettingsRow label="Loading Context Management..." />;
function Available({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoContextManagement): added v0.10.0; remove after 2027-04-25 when host floor >= v0.10.0.
  const available = useHostFeature(hostId, "ottoContextManagement");
  return available ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    <SettingsRow label="Update the host to use Context Management." />
  );
}
export function ContextManagementWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Available hostId={props.host.id}>
      <Workspace {...props} />
    </Available>
  );
}
export function ContextManagementScreen(props: PluginScreenProps) {
  return (
    <Available hostId={props.host.id}>
      <Screen key={props.host.id} {...props} />
    </Available>
  );
}
