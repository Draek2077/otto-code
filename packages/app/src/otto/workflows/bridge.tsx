import { lazy, Suspense, type ReactNode } from "react";
import type {
  PluginScreenProps,
  PluginWorkspacePanelProps,
  PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import { useHostFeature } from "@/runtime/host-features";
import { SettingsRow } from "@/components/settings";
const Screen = lazy(async () => ({ default: (await import("./screen")).WorkflowsScreen }));
const Workspace = lazy(async () => ({ default: (await import("./screen")).WorkflowsWorkspace }));
const Settings = lazy(async () => ({ default: (await import("./settings")).WorkflowsSettings }));
const loading = <SettingsRow label="Loading Workflows..." />;
function Available({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoWorkflows): added v0.10.0; remove after 2027-05-05 when host floor >= v0.10.0.
  const supported = useHostFeature(hostId, "ottoWorkflows");
  return supported ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    <SettingsRow label="Update the host to use Workflows." />
  );
}
export function WorkflowsScreen(props: PluginScreenProps) {
  return (
    <Available hostId={props.host.id}>
      <Screen {...props} />
    </Available>
  );
}
export function WorkflowsWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <Available hostId={props.host.id}>
      <Workspace {...props} />
    </Available>
  );
}
export function WorkflowsSettings(props: PluginSurfaceProps) {
  return (
    <Available hostId={props.host.id}>
      <Settings {...props} />
    </Available>
  );
}
