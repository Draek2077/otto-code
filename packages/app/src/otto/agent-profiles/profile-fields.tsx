import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  cueMoments,
  profileRoles,
  ProfileVoice,
  ProfileCues,
  type CueMoment,
} from "@getpaseo/protocol/otto/agent-teams";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/components/settings";
import { VoiceChoice } from "./voice-choice";

const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[3] },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
}));
function initialFields(profile?: AgentProfile) {
  const colors = profile?.spinner;
  const spinner =
    colors &&
    typeof colors === "object" &&
    "glowA" in colors &&
    "glowB" in colors &&
    typeof colors.glowA === "string" &&
    typeof colors.glowB === "string"
      ? { glowA: colors.glowA, glowB: colors.glowB }
      : undefined;
  const voice = ProfileVoice.safeParse(profile?.voice);
  const cues = ProfileCues.safeParse(profile?.voiceCues);
  const defaultRoles = profile ? [] : [...profileRoles];
  return {
    roles: Array.isArray(profile?.roles)
      ? profile.roles
          .filter((role): role is string => typeof role === "string")
          .map((role) => (role === "worker" ? "coder" : role))
      : defaultRoles,
    spinner,
    memoryEnabled: profile?.memoryEnabled !== false,
    respectGlobalAppendPrompt: profile?.respectGlobalAppendPrompt !== false,
    personalityPrompt:
      typeof profile?.personalityPrompt === "string" ? profile.personalityPrompt : "",
    voice: voice.success ? voice.data : undefined,
    voiceCues: cues.success ? cues.data : {},
  };
}
export type ProfileFields = ReturnType<typeof initialFields>;
export { initialFields };
function RoleButton({
  role,
  selected,
  toggle,
}: {
  role: string;
  selected: boolean;
  toggle: (role: string) => void;
}) {
  const press = useCallback(() => toggle(role), [role, toggle]);
  return (
    <Button size="sm" variant={selected ? "default" : "outline"} onPress={press}>
      {role}
    </Button>
  );
}
function CueField({
  moment,
  lines,
  change,
}: {
  moment: CueMoment;
  lines?: string[];
  change: (moment: CueMoment, value: string) => void;
}) {
  const set = useCallback((v: string) => change(moment, v), [moment, change]);
  return (
    <Field
      label={
        {
          join: "Joins",
          thinking: "Starts working",
          waiting: "Waits for teammates",
          done: "Finishes",
        }[moment]
      }
    >
      <FormTextInput
        testID={`profile-cue-${moment}`}
        multiline
        initialValue={lines?.join("\n") ?? ""}
        onChangeText={set}
      />
    </Field>
  );
}
export function IdentityFields({
  serverId,
  name,
  fields,
  set,
}: {
  serverId: string;
  name: string;
  profile?: AgentProfile;
  fields: ProfileFields;
  set: React.Dispatch<React.SetStateAction<ProfileFields>>;
}) {
  const client = useHostRuntimeClient(serverId);
  const [page, setPage] = useState<"identity" | "voice">("identity");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [version, refresh] = useState(0);
  const alive = useRef(true),
    inFlight = useRef(false),
    latest = useRef(fields);
  const latestName = useRef(name);
  latestName.current = name;
  latest.current = fields;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const generate = useCallback(
    async (kind: "prompt" | "cues") => {
      if (!client || inFlight.current || !name.trim()) return;
      const origin = fields;
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        const palette = origin.spinner ? [origin.spinner.glowA, origin.spinner.glowB] : [];
        const result = await client.authorProfile({
          kind,
          name,
          roles: origin.roles,
          prompt: origin.personalityPrompt,
          palette,
        });
        if (!alive.current) return;
        if (latest.current !== origin || latestName.current !== name) {
          setError("The Profile changed during generation. Generate again to use the new draft.");
          return;
        }
        set((previous) =>
          result.kind === "prompt"
            ? { ...previous, personalityPrompt: result.prompt }
            : { ...previous, voiceCues: result.cues },
        );
        refresh((v) => v + 1);
      } catch (e) {
        if (alive.current) setError(toErrorMessage(e));
      } finally {
        inFlight.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [client, fields, name, set],
  );
  const genPrompt = useCallback(() => void generate("prompt"), [generate]),
    genCues = useCallback(() => void generate("cues"), [generate]);
  const identity = useCallback(() => setPage("identity"), []),
    voice = useCallback(() => setPage("voice"), []);
  const toggle = useCallback(
    (role: string) =>
      set((f) => ({
        ...f,
        roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
      })),
    [set],
  );
  const prompt = useCallback((v: string) => set((f) => ({ ...f, personalityPrompt: v })), [set]);
  const change = useCallback(
    (m: CueMoment, v: string) =>
      set((f) => ({
        ...f,
        voiceCues: {
          ...f.voiceCues,
          [m]: v
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      })),
    [set],
  );
  const changeVoice = useCallback(
    (v: ProfileFields["voice"]) => set((f) => ({ ...f, voice: v })),
    [set],
  );
  const memory = useCallback(
    (value: boolean) => set((f) => ({ ...f, memoryEnabled: value })),
    [set],
  );
  const globalPrompt = useCallback(
    (value: boolean) => set((f) => ({ ...f, respectGlobalAppendPrompt: value })),
    [set],
  );
  const colors = useCallback(
    (key: "glowA" | "glowB", value: string) =>
      set((f) => {
        const spinner = { glowA: "", glowB: "", ...f.spinner, [key]: value.trim() };
        return { ...f, spinner: spinner.glowA || spinner.glowB ? spinner : undefined };
      }),
    [set],
  );
  const glowA = useCallback((v: string) => colors("glowA", v), [colors]),
    glowB = useCallback((v: string) => colors("glowB", v), [colors]);
  return (
    <View style={styles.fields}>
      <View style={styles.roles}>
        <Button size="sm" variant={page === "identity" ? "default" : "outline"} onPress={identity}>
          Identity
        </Button>
        <Button size="sm" variant={page === "voice" ? "default" : "outline"} onPress={voice}>
          Voice
        </Button>
      </View>
      {page === "identity" ? (
        <>
          <Field label="Roles">
            <View style={styles.roles}>
              {profileRoles.map((role) => (
                <RoleButton
                  key={role}
                  role={role}
                  selected={fields.roles.includes(role)}
                  toggle={toggle}
                />
              ))}
            </View>
          </Field>
          <Field label="Spinner start color">
            <FormTextInput
              initialValue={fields.spinner?.glowA ?? ""}
              placeholder="#RRGGBB"
              onChangeText={glowA}
            />
          </Field>
          <Field label="Spinner end color">
            <FormTextInput
              initialValue={fields.spinner?.glowB ?? ""}
              placeholder="#RRGGBB"
              onChangeText={glowB}
            />
          </Field>
          <SettingsRow label="Remember lessons">
            <Switch
              accessibilityLabel="Remember lessons"
              value={fields.memoryEnabled}
              onValueChange={memory}
            />
          </SettingsRow>
          <SettingsRow label="Include the host's additional instructions">
            <Switch
              value={fields.respectGlobalAppendPrompt}
              onValueChange={globalPrompt}
              accessibilityLabel="Include the host's additional instructions"
            />
          </SettingsRow>
          <Field label="Profile prompt">
            <FormTextInput
              key={version}
              multiline
              initialValue={fields.personalityPrompt}
              onChangeText={prompt}
            />
          </Field>
          <Button size="sm" variant="outline" disabled={busy || !name.trim()} onPress={genPrompt}>
            Generate prompt
          </Button>
        </>
      ) : (
        <>
          <VoiceChoice serverId={serverId} voice={fields.voice} change={changeVoice} />
          <Text style={settingsStyles.rowHint}>
            Enter one spoken line per row. Otto chooses a line when the chat changes state.
          </Text>
          {cueMoments.map((m) => (
            <CueField key={m + version} moment={m} lines={fields.voiceCues[m]} change={change} />
          ))}
          <Button size="sm" variant="outline" disabled={busy || !name.trim()} onPress={genCues}>
            Generate voice lines
          </Button>
        </>
      )}
      {!!error && <Text style={settingsStyles.rowError}>{error}</Text>}
    </View>
  );
}
