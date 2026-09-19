import { SettingsTargetScope, SettingsTargetText } from "@/screens/settings-search/target";
/**
 * The Default Team section of Project Settings. Ties an Agent Team to a
 * project so entering any workspace of that project switches the host's active
 * team (see use-project-default-team-switch.ts). "Not set" leaves the active
 * team alone.
 *
 * Stored daemon-side in `agentTeams.projectDefaults` next to activeTeamId, so
 * every client of the host agrees. Saves on selection, like the other storage
 * preferences on this page.
 *
 * i18n: English-only pending a translation pass (build-first, translate-last).
 */
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { findAgentTeam } from "@otto-code/protocol/agent-teams";
import type { SelectFieldDisplay, SelectFieldOption } from "@/components/ui/select-field";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { SettingsSelectField as SelectField } from "@/screens/settings-search/fields";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { settingsStyles } from "@/styles/settings";

const SETTING_ID = "host-projects-project-settings-team-default-team";
const NOT_SET = "__not-set__";
const NOT_SET_DISPLAY: SelectFieldDisplay = { label: "Not set" };

export function ProjectTeamSection({
  serverId,
  projectId,
}: {
  serverId: string;
  projectId: string;
}) {
  const toast = useToast();
  const supported = useHostFeature(serverId, "agentTeamProjectDefaults");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const teams = useMemo(() => config?.agentTeams?.teams ?? [], [config]);
  // A default pointing at a deleted team reads as "Not set" until the daemon
  // heals it on the next teams write.
  const storedTeamId =
    findAgentTeam(teams, config?.agentTeams?.projectDefaults?.[projectId])?.id ?? null;
  const [pendingTeamId, setPendingTeamId] = useState<string | null | undefined>(undefined);
  const value =
    pendingTeamId === undefined ? (storedTeamId ?? NOT_SET) : (pendingTeamId ?? NOT_SET);

  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: NOT_SET, value: NOT_SET, label: NOT_SET_DISPLAY.label },
      ...teams.map((team) => ({ id: team.id, value: team.id, label: team.name })),
    ],
    [teams],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(() => {
    const team = findAgentTeam(teams, value === NOT_SET ? null : value);
    return team ? { label: team.name } : NOT_SET_DISPLAY;
  }, [teams, value]);

  const handleChange = useCallback(
    (next: string) => {
      if (next === value) return;
      const teamId = next === NOT_SET ? null : next;
      setPendingTeamId(teamId);
      void (async () => {
        try {
          await patchConfig({ agentTeams: { projectDefaults: { [projectId]: teamId } } });
        } catch {
          toast.show("Could not save the default team.");
        } finally {
          setPendingTeamId(undefined);
        }
      })();
    },
    [patchConfig, projectId, toast, value],
  );

  // Zero-setup invariant, same as the Active Team switcher: no teams on the
  // host means no team controls anywhere.
  if (!supported || teams.length === 0) return null;

  return (
    <SettingsGroup title="Team" testID="project-team-group">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <SettingsTargetText settingId={SETTING_ID} style={settingsStyles.rowTitle}>
              Default team
            </SettingsTargetText>
            <Text style={settingsStyles.rowHint}>
              Opening any workspace in this project switches the active team to this team. Not set
              leaves the active team as it is.
            </Text>
          </View>
          <SettingsTargetScope settingIds={[SETTING_ID]}>
            <SelectField<string>
              field={false}
              size="sm"
              label="Default team"
              value={value}
              selectedDisplay={selectedDisplay}
              options={options}
              onChange={handleChange}
              placeholder={NOT_SET_DISPLAY.label}
              emptyText="No teams on this host."
              searchable={teams.length > 8}
              loading={pendingTeamId !== undefined}
              disabled={pendingTeamId !== undefined}
              triggerStyle={styles.trigger}
              triggerTestID="project-default-team"
            />
          </SettingsTargetScope>
        </View>
      </View>
    </SettingsGroup>
  );
}

const styles = StyleSheet.create(() => ({
  trigger: {
    minWidth: 180,
  },
}));
