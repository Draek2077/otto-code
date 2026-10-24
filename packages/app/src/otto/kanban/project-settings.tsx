/** Otto-owned Project Settings slot, using the plugin installation's existing client and RPC. */
import { useMemo } from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { PluginInstallationProvider } from "@/plugins/installation-provider";
import { SurfaceErrorBoundary } from "@/plugins/surface-error-boundary";
import { useInstalledPlugin } from "@/plugins/registry";
import { usePluginHostNavigation } from "@/plugins/host-navigation";
import { toPluginTheme } from "@/plugins/theme";
import { useHosts } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import type { Theme } from "@/styles/theme";

interface Identity {
  serverId: string;
  projectId: string;
}

function ProjectSettingsSlot({
  serverId,
  projectId,
  theme,
}: Identity & {
  theme: PluginScreenProps["theme"];
}) {
  const plugin = useInstalledPlugin(serverId, "otto-kanban");
  // COMPAT(ottoKanban): added in v0.10.0; remove after 2027-04-24 when floor is v0.10.0.
  const supported = useHostFeature(serverId, "ottoKanban");
  const navigation = usePluginHostNavigation(serverId);
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const host = useMemo(
    () => ({
      id: serverId,
      label: hosts.find((value) => value.serverId === serverId)?.label ?? serverId,
    }),
    [hosts, serverId],
  );
  const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
  const layout = useMemo<PluginScreenProps["layout"]>(
    () => ({ compact, platform }),
    [compact, platform],
  );
  const params = useMemo(() => ({ projectHostId: serverId, projectId }), [serverId, projectId]);
  if (!supported || !plugin) return null;
  const section = plugin.surfaces.find((screen) => screen.id === "project-settings");
  if (!section) return <Alert variant="info" description="Update the host to configure Kanban." />;
  const Component = section.Component;
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Component}>
      <PluginInstallationProvider plugin={plugin}>
        <Component
          theme={theme}
          host={host}
          layout={layout}
          params={params}
          navigation={navigation}
        />
      </PluginInstallationProvider>
    </SurfaceErrorBoundary>
  );
}

const themeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });
const ThemedProjectSettingsSlot = withUnistyles(ProjectSettingsSlot);

export function OttoKanbanProjectSettings(props: Identity) {
  return <ThemedProjectSettingsSlot {...props} uniProps={themeMapping} />;
}
