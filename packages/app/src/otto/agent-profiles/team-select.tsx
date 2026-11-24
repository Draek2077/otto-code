import { useCallback, useEffect, useMemo, useRef } from "react";
import { Users } from "lucide-react-native";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { ICON_SIZE, type Theme } from "@/styles/theme";

import { useHosts } from "@/runtime/host-runtime";
const Icon = withUnistyles(Users);
const tint = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const leading = <Icon size={ICON_SIZE.sm} uniProps={tint} />;
export function SidebarTeamSwitcher() {
  const scope = useActiveWorkspaceSelection();
  const workspace = useWorkspace(scope?.serverId ?? null, scope?.workspaceId ?? null);
  const hosts = useHosts();
  const serverId = scope?.serverId ?? (hosts.length === 1 ? hosts[0]?.serverId : undefined);
  return serverId ? (
    <TeamSelection
      serverId={serverId}
      workspaceId={scope?.workspaceId}
      projectId={workspace?.projectId}
    />
  ) : null;
}
function teamColor(
  config: import("@getpaseo/protocol/otto/agent-teams").AgentTeams | undefined,
  id: string,
) {
  return config?.teams?.find((t) => t.id === id)?.avatar?.color;
}
export function TeamSelection({
  serverId,
  projectId,
  workspaceId,
  projectDefault = false,
}: {
  serverId: string;
  projectId?: string;
  workspaceId?: string;
  projectDefault?: boolean;
}) {
  const supported = useHostFeature(serverId, "ottoAgentTeams");
  const { config, patchConfig } = useDaemonConfig(supported ? serverId : null);
  const section = config?.agentTeams;
  const toast = useToast();
  const projectTeam = projectId ? section?.projectDefaults?.[projectId] : undefined;
  const applied = useRef("");
  useEffect(() => {
    if (projectDefault || !config || !workspaceId || !projectId) return;
    const key = JSON.stringify([serverId, workspaceId, projectId, projectTeam]);
    if (applied.current === key) return;
    applied.current = key;
    if (
      projectTeam &&
      projectTeam !== section?.activeTeamId &&
      section?.teams?.some((team) => team.id === projectTeam)
    )
      void patchConfig({ agentTeams: { activeTeamId: projectTeam } }).catch((error) =>
        toast.error(toErrorMessage(error)),
      );
  }, [
    config,
    patchConfig,
    projectDefault,
    projectId,
    projectTeam,
    section,
    serverId,
    toast,
    workspaceId,
  ]);
  const options = useMemo(
    () => [
      { id: "", value: "", label: projectDefault ? "No project default" : "No active team" },
      ...(section?.teams ?? []).map((team) => ({ id: team.id, value: team.id, label: team.name })),
    ],
    [projectDefault, section?.teams],
  );
  const select = useCallback(
    (id: string) => {
      if (projectDefault && projectId) {
        const defaults = { ...section?.projectDefaults };
        if (id) defaults[projectId] = id;
        else delete defaults[projectId];
        void patchConfig({ agentTeams: { projectDefaults: defaults } }).catch((error) =>
          toast.error(toErrorMessage(error)),
        );
      } else
        void patchConfig({ agentTeams: { activeTeamId: id || null } }).catch((error) =>
          toast.error(toErrorMessage(error)),
        );
    },
    [patchConfig, projectDefault, projectId, section?.projectDefaults, toast],
  );
  const id = (projectDefault ? projectTeam : section?.activeTeamId) ?? "";
  const color = teamColor(section, id);
  const icon = useMemo(
    () => (color ? <Users size={ICON_SIZE.sm} color={color} /> : leading),
    [color],
  );
  if (!supported || options.length === 1) return null;
  const field = (
    <SelectField
      field={false}
      size="sm"
      desktopMatchTrigger={!projectDefault}
      triggerLeading={icon}
      label={projectDefault ? "Default team" : "Active team"}
      value={id}
      selectedDisplay={options.find((o) => o.id === id) ?? options[0] ?? null}
      options={options}
      onChange={select}
      placeholder="Choose team"
      emptyText="No teams"
      testID={projectDefault ? "project-default-team" : "active-team-switcher"}
    />
  );
  return projectDefault ? (
    <SettingsSection title="Default team">{field}</SettingsSection>
  ) : (
    <View style={styles.sidebarField}>{field}</View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebarField: {
    paddingHorizontal: theme.spacing[2],
  },
}));
