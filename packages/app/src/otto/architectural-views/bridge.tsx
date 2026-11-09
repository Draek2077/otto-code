import { lazy, Suspense, type ReactNode } from "react";
import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Screen = lazy(async () => ({ default: (await import("./screen")).ArchitecturalViewsScreen }));
const Workspace = lazy(async () => ({
  default: (await import("./screen")).ArchitecturalViewsWorkspace,
}));
const loading = <SettingsRow label="Loading Architectural Views..." />;
function Available({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoArchitecturalViews): added v0.10.0; remove after 2027-05-09 when host floor >= v0.10.0.
  const available = useHostFeature(hostId, "ottoArchitecturalViews");
  return available ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    <SettingsRow label="Update the host to use Architectural Views." />
  );
}
export function ArchitecturalViewsScreen(props: PluginScreenProps) {
  return (
    <Available hostId={props.host.id}>
      <Screen key={props.host.id} {...props} />
    </Available>
  );
}
export function ArchitecturalViewsWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Available hostId={props.host.id}>
      <Workspace {...props} />
    </Available>
  );
}
