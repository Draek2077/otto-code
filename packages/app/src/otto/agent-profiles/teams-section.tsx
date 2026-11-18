import { missingStarters } from "@getpaseo/protocol/otto/starter-roster";
import { useToast } from "@/contexts/toast-context";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { Team } from "@getpaseo/protocol/otto/agent-teams";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { generateAgentProfileId } from "@/agent-profiles/internal/profile-id";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { settingsStyles } from "@/styles/settings";
import { StyleSheet } from "react-native-unistyles";

const header = { title: "Agent team" };
const styles = StyleSheet.create((theme) => ({
  order: { flexDirection: "row" },
  form: { gap: theme.spacing[3], padding: theme.spacing[4] },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
}));
function MemberRow({
  profile,
  selected,
  toggle,
  priority,
  move,
  count,
}: {
  profile: AgentProfile;
  selected: boolean;
  toggle: (id: string) => void;
  priority: number;
  count: number;
  move: (id: string, step: number) => void;
}) {
  const change = useCallback(() => toggle(profile.id), [toggle, profile.id]);
  const up = useCallback(() => move(profile.id, -1), [move, profile.id]),
    down = useCallback(() => move(profile.id, 1), [move, profile.id]);
  return (
    <SettingsRow
      label={profile.name}
      hint={[profile.provider, profile.model].filter(Boolean).join(" · ")}
    >
      {selected && count > 1 && (
        <View style={styles.order}>
          <Button
            size="sm"
            variant="ghost"
            onPress={up}
            disabled={priority === 0}
            accessibilityLabel={`Move ${profile.name} up`}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={down}
            disabled={priority === count - 1}
            accessibilityLabel={`Move ${profile.name} down`}
          >
            ↓
          </Button>
        </View>
      )}
      <Switch value={selected} onValueChange={change} accessibilityLabel={profile.name} />
    </SettingsRow>
  );
}
function TeamRow({ team, edit }: { team: Team; edit: (team: Team) => void }) {
  const open = useCallback(() => edit(team), [edit, team]);
  return (
    <SettingsRow label={team.name} hint={`${team.memberIds?.length ?? 0} members`}>
      <Button variant="ghost" size="sm" onPress={open}>
        Edit
      </Button>
    </SettingsRow>
  );
}
interface Edit {
  team: Team;
  base: Team[];
  isNew: boolean;
}
function Editor({
  edit,
  profiles,
  save,
  close,
}: {
  edit: Edit;
  profiles: AgentProfile[];
  save: (edit: Edit, team: Team | null) => Promise<void>;
  close: () => void;
}) {
  const [name, setName] = useState(edit.team.name),
    [prompt, setPrompt] = useState(edit.team.teamPrompt ?? ""),
    [color, setColor] = useState(edit.team.avatar?.color ?? ""),
    [ids, setIds] = useState(edit.team.memberIds ?? []);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const toggle = useCallback(
    (id: string) =>
      setIds((current) =>
        current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      ),
    [],
  );
  const ordered = useMemo(() => {
    const available = new Map(profiles.map((p) => [p.id, p]));
    const members = ids.flatMap((id) => available.get(id) ?? []);
    const selected = new Set(ids);
    return [...members, ...profiles.filter((p) => !selected.has(p.id))];
  }, [profiles, ids]);
  const move = useCallback(
    (id: string, step: number) =>
      setIds((current) => {
        const index = current.indexOf(id),
          next = index + step;
        if (index < 0 || next < 0 || next >= current.length) return current;
        const result = current.slice();
        result.splice(index, 1);
        result.splice(next, 0, id);
        return result;
      }),
    [],
  );
  const submit = useCallback(
    async (remove: boolean) => {
      setBusy(true);
      try {
        if (
          remove &&
          !(await confirmDialog({
            title: "Delete team?",
            message: "Member Profiles stay on this host.",
            confirmLabel: "Delete",
            destructive: true,
          }))
        )
          return;
        if (!remove && color && !/^#[a-f0-9]{6}$/i.test(color))
          throw new Error("Use a six-digit hex color for the team icon.");
        await save(
          edit,
          remove
            ? null
            : {
                ...edit.team,
                name: name.trim(),
                teamPrompt: prompt,
                memberIds: ids,
                avatar: { ...edit.team.avatar, color: color || undefined },
              },
        );
        close();
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [close, color, edit, ids, name, prompt, save],
  );
  const saveTeam = useCallback(() => void submit(false), [submit]),
    removeTeam = useCallback(() => void submit(true), [submit]);
  return (
    <AdaptiveModalSheet visible header={header} onClose={close} desktopMaxWidth={520}>
      <View style={styles.form}>
        <Field label="Team name">
          <FormTextInput initialValue={edit.team.name} onChangeText={setName} />
        </Field>
        <Field label="Team icon color">
          <FormTextInput initialValue={color} placeholder="#RRGGBB" onChangeText={setColor} />
        </Field>
        <Field label="Team prompt">
          <FormTextInput
            multiline
            initialValue={edit.team.teamPrompt ?? ""}
            onChangeText={setPrompt}
          />
        </Field>
        <SettingsSection title="Members">
          <SettingsCard>
            {ordered.map((profile) => (
              <MemberRow
                key={profile.id}
                profile={profile}
                selected={ids.includes(profile.id)}
                priority={ids.indexOf(profile.id)}
                count={ids.length}
                move={move}
                toggle={toggle}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
        {!!error && <Text style={settingsStyles.rowError}>{error}</Text>}
        <View style={styles.actions}>
          {!edit.isNew && (
            <Button variant="destructive" size="sm" disabled={busy} onPress={removeTeam}>
              Delete team
            </Button>
          )}
          <Button disabled={busy || !name.trim()} onPress={saveTeam}>
            {edit.isNew ? "Create team" : "Save changes"}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}
export function TeamsSection({ serverId }: { serverId: string }) {
  const supported = useHostFeature(serverId, "ottoAgentTeams");
  const { config, patchConfig } = useDaemonConfig(supported ? serverId : null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const open = useCallback(
    (team: Team) => setEdit({ team, isNew: false, base: config?.agentTeams?.teams ?? [] }),
    [config],
  );
  const add = useCallback(
    () =>
      setEdit({
        team: { id: generateAgentProfileId(), name: "" },
        isNew: true,
        base: config?.agentTeams?.teams ?? [],
      }),
    [config],
  );
  const close = useCallback(() => setEdit(null), []);
  const save = useCallback(
    async (editing: Edit, value: Team | null) => {
      if (
        value &&
        editing.base.some(
          (t) => t.id !== value.id && t.name.toLowerCase() === value.name.toLowerCase(),
        )
      )
        throw new Error("A team already uses this name.");
      const replacement = value ? [value] : [];
      const teams = editing.base.flatMap((t) => (t.id === editing.team.id ? replacement : [t]));
      if (editing.isNew && value) teams.push(value);
      if (
        !(await patchConfig({
          expectedTeamRoster: editing.base,
          agentTeams: {
            teams,
          },
        }))
      )
        throw new Error("The host disconnected.");
    },
    [patchConfig],
  );
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);
  const missing = useMemo(
    () => missingStarters(config?.agentProfiles ?? [], config?.agentTeams?.teams ?? []),
    [config],
  );
  const restore = useCallback(async () => {
    if (!config || restoring) return;
    const profiles = config.agentProfiles ?? [];
    const teams = config.agentTeams?.teams ?? [];
    setRestoring(true);
    try {
      if (
        !(await patchConfig({
          expectedProfileRoster: profiles,
          expectedTeamRoster: teams,
          agentProfiles: [...profiles, ...missing.profiles],
          agentTeams: { teams: [...teams, ...missing.teams] },
        }))
      )
        throw new Error("The host disconnected.");
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setRestoring(false);
    }
  }, [config, missing, patchConfig, restoring, toast]);
  const addButton = useMemo(
    () => (
      <Button size="sm" onPress={add}>
        Add team
      </Button>
    ),
    [add],
  );
  if (!supported || !config) return null;
  return (
    <SettingsSection title="Agent teams" trailing={addButton}>
      <SettingsCard>
        {config.agentTeams?.teams?.length ? (
          config.agentTeams.teams.map((t) => <TeamRow key={t.id} team={t} edit={open} />)
        ) : (
          <SettingsRow
            label="No teams yet"
            hint="Group Profiles to choose who handles chats and Workflow roles."
          />
        )}
        {missing.teams.length + missing.profiles.length > 0 && (
          <SettingsRow
            label="The Otto Crew"
            hint="Restore missing starter Profiles and Team membership. Existing Profiles and Teams keep your edits."
          >
            <Button size="sm" variant="outline" onPress={restore} disabled={restoring}>
              Restore missing
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
      {edit && (
        <Editor edit={edit} profiles={config.agentProfiles ?? []} save={save} close={close} />
      )}
    </SettingsSection>
  );
}
