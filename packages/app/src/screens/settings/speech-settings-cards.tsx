import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  MutableDaemonConfigPatch,
  MutableSpeechConfig,
  SpeechSettingsOptions,
} from "@otto-code/protocol/messages";
import { ChevronDown } from "@/components/icons/material-icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import {
  useTtsPreviewFeature,
  VOICE_PREVIEW_SAMPLE_TEXT,
  VoicePreviewButton,
} from "@/screens/settings/voice-preview-button";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

/**
 * The single detection point for the speech settings capability.
 * COMPAT(speechSettings): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
 */
export function useSpeechSettingsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.speechSettings === true,
  );
}

function speechSettingsOptionsQueryKey(serverId: string): [string, string] {
  return ["speech-settings-options", serverId];
}

export function useSpeechSettingsOptions(serverId: string, enabled: boolean) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  return useFetchQuery({
    queryKey: speechSettingsOptionsQueryKey(serverId),
    enabled: enabled && Boolean(client && isConnected),
    dataShape: "value",
    // Options are near-static per daemon process; saving an OpenAI key
    // invalidates this so engine availability refreshes.
    staleTimeMs: 5 * 60 * 1000,
    queryFn: async (): Promise<SpeechSettingsOptions> => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const result = await client.getSpeechSettingsOptions();
      return result.options;
    },
  });
}

// Kokoro voice names encode language/accent + gender in a two-letter prefix.
const KOKORO_PREFIX_LABELS: Record<string, string> = {
  af: "American female",
  am: "American male",
  bf: "British female",
  bm: "British male",
  ef: "Spanish female",
  em: "Spanish male",
  ff: "French female",
  fm: "French male",
  hf: "Hindi female",
  hm: "Hindi male",
  if: "Italian female",
  im: "Italian male",
  jf: "Japanese female",
  jm: "Japanese male",
  pf: "Portuguese female",
  pm: "Portuguese male",
  zf: "Chinese female",
  zm: "Chinese male",
};

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function formatVoiceLabel(name: string): string {
  const separatorIndex = name.indexOf("_");
  if (separatorIndex <= 0) {
    return capitalize(name);
  }
  const prefix = name.slice(0, separatorIndex);
  const rest = name.slice(separatorIndex + 1);
  const prefixLabel = KOKORO_PREFIX_LABELS[prefix];
  if (!prefixLabel || rest.length === 0) {
    return capitalize(name);
  }
  return `${capitalize(rest)} (${prefixLabel})`;
}

function toVoiceOptions(voices: string[]): ComboboxOption[] {
  return voices.map((name) => ({ id: name, label: formatVoiceLabel(name) }));
}

const SPEED_PRESETS: SegmentedControlOption<string>[] = [
  { value: "0.75", label: "0.75×" },
  { value: "1", label: "1×" },
  { value: "1.25", label: "1.25×" },
  { value: "1.5", label: "1.5×" },
];

function engineLabel(t: TFunction, engineId: string): string {
  return engineId === "local"
    ? t("settings.host.speech.engines.local")
    : t("settings.host.speech.engines.openai");
}

function useEngineOptions(options: SpeechSettingsOptions, kind: "stt" | "tts"): ComboboxOption[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const engines = kind === "tts" ? options.ttsEngines : options.sttEngines;
    return engines.map((engine) => {
      const option: ComboboxOption = { id: engine.id, label: engineLabel(t, engine.id) };
      if (!engine.available && engine.reason) {
        option.description = engine.reason;
      }
      return option;
    });
  }, [options, kind, t]);
}

function useSttModelOptions(options: SpeechSettingsOptions, engine: string): ComboboxOption[] {
  return useMemo(() => {
    if (engine === "openai") {
      return options.openai.sttModels.map((model) => ({ id: model, label: model }));
    }
    return options.local.sttModels.map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      description: model.description,
    }));
  }, [options, engine]);
}

function useTtsModelOptions(options: SpeechSettingsOptions, engine: string): ComboboxOption[] {
  return useMemo(() => {
    if (engine === "openai") {
      return options.openai.ttsModels.map((model) => ({ id: model, label: model }));
    }
    return options.local.ttsModels.map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      description: model.description,
    }));
  }, [options, engine]);
}

function defaultSttModel(options: SpeechSettingsOptions, engine: string): string {
  if (engine === "openai") {
    return options.openai.sttModels[0] ?? "";
  }
  return options.local.sttModels[0]?.id ?? "";
}

function defaultTts(
  options: SpeechSettingsOptions,
  engine: string,
): { model: string; voice: string } {
  if (engine === "openai") {
    return {
      model: options.openai.ttsModels[0] ?? "",
      voice: options.openai.ttsVoices[0] ?? "",
    };
  }
  const model = options.local.ttsModels[0];
  return { model: model?.id ?? "", voice: model?.defaultVoice ?? "" };
}

interface SttSelection {
  engine: string;
  model: string;
}

function readSttSelection(stt: { provider?: string; model?: string } | undefined): SttSelection {
  return { engine: stt?.provider ?? "local", model: stt?.model ?? "" };
}

interface TtsSelection {
  engine: string;
  model: string;
  voice: string;
  speed: number;
}

function readTtsSelection(speech: MutableSpeechConfig | null): TtsSelection {
  const tts = speech?.voiceMode?.tts;
  return {
    engine: tts?.provider ?? "local",
    model: tts?.model ?? "",
    voice: tts?.voice ?? "",
    speed: tts?.speed ?? 1,
  };
}

type ApplyPatch = (patch: MutableDaemonConfigPatch) => void;

// ---------------------------------------------------------------------------
// Row primitives — title (+ hint) on the left, compact control on the right,
// matching the appearance section's picker rows.
// ---------------------------------------------------------------------------

const ThemedChevronDown = withUnistyles(ChevronDown);

const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

interface ToggleRowProps {
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID: string;
  bordered?: boolean;
}

function ToggleRow({ title, hint, value, onValueChange, testID, bordered }: ToggleRowProps) {
  return (
    <View style={bordered ? ROW_WITH_BORDER_STYLE : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={title}
        testID={testID}
      />
    </View>
  );
}

interface PickerRowProps {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (next: string) => void;
  testID: string;
  // Optional control rendered just left of the dropdown trigger (e.g. a voice
  // preview button).
  trailing?: ReactNode;
}

function PickerRow({ label, value, options, onChange, testID, trailing }: PickerRowProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.id === value);
  const triggerLabel = selected?.label ?? value;

  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || pressed || open) && styles.triggerActive,
    ],
    [open],
  );

  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
      </View>
      {trailing}
      <View ref={anchorRef} collapsable={false} style={styles.triggerAnchor}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
        >
          <Text
            style={triggerLabel ? styles.triggerText : styles.triggerPlaceholder}
            numberOfLines={1}
          >
            {triggerLabel || label}
          </Text>
          <ThemedChevronDown uniProps={chevronMapping} />
        </Pressable>
      </View>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        searchable={options.length > 8}
        title={label}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopMinWidth={240}
      />
    </View>
  );
}

interface SpeedRowProps {
  label: string;
  value: number;
  onChange: (next: string) => void;
  testID: string;
}

function SpeedRow({ label, value, onChange, testID }: SpeedRowProps) {
  return (
    <View style={ROW_RESPONSIVE_WITH_BORDER}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
      </View>
      <SegmentedControl
        size="sm"
        value={String(value)}
        onValueChange={onChange}
        options={SPEED_PRESETS}
        testID={testID}
      />
    </View>
  );
}

function ErrorRow({ message, testID }: { message: string; testID?: string }) {
  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowError} testID={testID}>
          {message}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

interface SpeechCardProps {
  speech: MutableSpeechConfig | null;
  options: SpeechSettingsOptions;
  apply: ApplyPatch;
}

function DictationCard({ speech, options, apply }: SpeechCardProps) {
  const { t } = useTranslation();
  const enabled = speech?.dictation?.enabled !== false;
  const stt = readSttSelection(speech?.dictation?.stt);
  const engineOptions = useEngineOptions(options, "stt");
  const modelOptions = useSttModelOptions(options, stt.engine);

  const onEnabled = useCallback(
    (next: boolean) => apply({ speech: { dictation: { enabled: next } } }),
    [apply],
  );
  const onEngine = useCallback(
    (engine: string) =>
      apply({
        speech: {
          dictation: { stt: { provider: engine, model: defaultSttModel(options, engine) } },
        },
      }),
    [apply, options],
  );
  const onModel = useCallback(
    (model: string) => apply({ speech: { dictation: { stt: { model } } } }),
    [apply],
  );

  return (
    <View style={settingsStyles.card} testID="host-speech-dictation-card">
      <ToggleRow
        title={t("settings.host.speech.dictation.title")}
        hint={t("settings.host.speech.dictation.hint")}
        value={enabled}
        onValueChange={onEnabled}
        testID="host-speech-dictation-switch"
      />
      <PickerRow
        label={t("settings.host.speech.dictation.engine")}
        value={stt.engine}
        options={engineOptions}
        onChange={onEngine}
        testID="host-speech-dictation-engine"
      />
      <PickerRow
        label={t("settings.host.speech.dictation.model")}
        value={stt.model}
        options={modelOptions}
        onChange={onModel}
        testID="host-speech-dictation-model"
      />
    </View>
  );
}

function VoiceModeCard({
  serverId,
  speech,
  options,
  apply,
  showError,
}: SpeechCardProps & {
  serverId: string;
  showError: boolean;
}) {
  const { t } = useTranslation();
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings();
  const enabled = speech?.voiceMode?.enabled !== false;
  const stt = readSttSelection(speech?.voiceMode?.stt);
  const tts = readTtsSelection(speech);
  const engineOptions = useEngineOptions(options, "stt");
  const ttsEngineOptions = useEngineOptions(options, "tts");
  const sttModelOptions = useSttModelOptions(options, stt.engine);
  const ttsModelOptions = useTtsModelOptions(options, tts.engine);

  const voiceOptions = useMemo(() => {
    if (tts.engine === "openai") {
      return toVoiceOptions(options.openai.ttsVoices);
    }
    const model = options.local.ttsModels.find((entry) => entry.id === tts.model);
    return toVoiceOptions(model?.voices ?? []);
  }, [options, tts.engine, tts.model]);

  const voicePreview = useMemo(
    () =>
      canPreviewVoice && tts.voice ? (
        <VoicePreviewButton
          serverId={serverId}
          text={VOICE_PREVIEW_SAMPLE_TEXT}
          voiceName={tts.voice}
          voiceModel={tts.model}
          voiceProvider={tts.engine}
          testID="host-speech-voice-tts-preview"
        />
      ) : undefined,
    [canPreviewVoice, serverId, tts.engine, tts.model, tts.voice],
  );

  const onEnabled = useCallback(
    (next: boolean) => apply({ speech: { voiceMode: { enabled: next } } }),
    [apply],
  );
  const onSttEngine = useCallback(
    (engine: string) =>
      apply({
        speech: {
          voiceMode: { stt: { provider: engine, model: defaultSttModel(options, engine) } },
        },
      }),
    [apply, options],
  );
  const onSttModel = useCallback(
    (model: string) => apply({ speech: { voiceMode: { stt: { model } } } }),
    [apply],
  );
  const onTtsEngine = useCallback(
    (engine: string) => {
      const defaults = defaultTts(options, engine);
      apply({
        speech: {
          voiceMode: { tts: { provider: engine, model: defaults.model, voice: defaults.voice } },
        },
      });
    },
    [apply, options],
  );
  const onTtsModel = useCallback(
    (model: string) => {
      const entry = options.local.ttsModels.find((candidate) => candidate.id === model);
      const voicePatch = entry ? { voice: entry.defaultVoice } : {};
      apply({ speech: { voiceMode: { tts: { model, ...voicePatch } } } });
    },
    [apply, options],
  );
  const onVoice = useCallback(
    (voice: string) => apply({ speech: { voiceMode: { tts: { voice } } } }),
    [apply],
  );
  const onSpeed = useCallback(
    (raw: string) => {
      const speed = Number.parseFloat(raw);
      if (Number.isFinite(speed) && speed > 0) {
        apply({ speech: { voiceMode: { tts: { speed } } } });
      }
    },
    [apply],
  );
  const onThinkingTone = useCallback(
    (next: boolean) => {
      void updateAppSettings({ voiceThinkingTone: next });
    },
    [updateAppSettings],
  );

  return (
    <View style={settingsStyles.card} testID="host-speech-voice-mode-card">
      <ToggleRow
        title={t("settings.host.speech.voiceMode.title")}
        hint={t("settings.host.speech.voiceMode.hint")}
        value={enabled}
        onValueChange={onEnabled}
        testID="host-speech-voice-mode-switch"
      />
      <PickerRow
        label={t("settings.host.speech.voiceMode.sttEngine")}
        value={stt.engine}
        options={engineOptions}
        onChange={onSttEngine}
        testID="host-speech-voice-stt-engine"
      />
      <PickerRow
        label={t("settings.host.speech.voiceMode.sttModel")}
        value={stt.model}
        options={sttModelOptions}
        onChange={onSttModel}
        testID="host-speech-voice-stt-model"
      />
      <PickerRow
        label={t("settings.host.speech.voiceMode.ttsEngine")}
        value={tts.engine}
        options={ttsEngineOptions}
        onChange={onTtsEngine}
        testID="host-speech-voice-tts-engine"
      />
      <PickerRow
        label={t("settings.host.speech.voiceMode.ttsModel")}
        value={tts.model}
        options={ttsModelOptions}
        onChange={onTtsModel}
        testID="host-speech-voice-tts-model"
      />
      <PickerRow
        label={t("settings.host.speech.voiceMode.voice")}
        value={tts.voice}
        options={voiceOptions}
        onChange={onVoice}
        testID="host-speech-voice-tts-voice"
        trailing={voicePreview}
      />
      <SpeedRow
        label={t("settings.host.speech.voiceMode.speed")}
        value={tts.speed}
        onChange={onSpeed}
        testID="host-speech-voice-tts-speed"
      />
      <ToggleRow
        title={t("settings.host.speech.voiceMode.thinkingTone")}
        hint={t("settings.host.speech.voiceMode.thinkingToneHint")}
        value={appSettings.voiceThinkingTone}
        onValueChange={onThinkingTone}
        testID="host-speech-voice-thinking-tone-switch"
        bordered
      />
      {showError ? (
        <ErrorRow message={t("settings.host.speech.saveError")} testID="host-speech-save-error" />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// OpenAI API key — one shared key for the OpenAI STT/TTS engines. Commits on
// blur/submit; an empty value clears the stored key on the host.
// ---------------------------------------------------------------------------

function OpenAiKeyCard({
  speech,
  apply,
  showError,
}: {
  speech: MutableSpeechConfig | null;
  apply: ApplyPatch;
  showError: boolean;
}) {
  const { t } = useTranslation();
  const persistedKey = speech?.openai?.apiKey ?? "";
  const [draft, setDraft] = useState(persistedKey);

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    setDraft(persistedKey);
  }, [persistedKey]);

  const handleCommit = useCallback(() => {
    const next = draft.trim();
    if (next === persistedKey.trim()) {
      return;
    }
    apply({ speech: { openai: { apiKey: next } } });
  }, [apply, draft, persistedKey]);

  return (
    <View style={settingsStyles.card} testID="host-speech-openai-key-card">
      <View style={settingsStyles.rowResponsive}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.speech.openaiKey.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.speech.openaiKey.hint")}</Text>
        </View>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={handleCommit}
          onSubmitEditing={handleCommit}
          placeholder={t("settings.host.speech.openaiKey.placeholder")}
          placeholderTextColor={styles.placeholderColor.color}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.keyInput}
          accessibilityLabel={t("settings.host.speech.openaiKey.title")}
          testID="host-speech-openai-key-input"
        />
      </View>
      {showError ? (
        <ErrorRow message={t("settings.host.speech.saveError")} testID="host-speech-key-error" />
      ) : null}
    </View>
  );
}

/**
 * The key card only earns its place once OpenAI backs one of the three engine
 * slots — otherwise it's a field nobody in this configuration uses.
 */
function usesOpenAiEngine(speech: MutableSpeechConfig | null): boolean {
  return (
    speech?.dictation?.stt?.provider === "openai" ||
    speech?.voiceMode?.stt?.provider === "openai" ||
    speech?.voiceMode?.tts?.provider === "openai"
  );
}

export function SpeechSettingsCards({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const hasFeature = useSpeechSettingsFeature(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const optionsQuery = useSpeechSettingsOptions(serverId, hasFeature);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (patch: MutableDaemonConfigPatch) => {
      const result = await patchConfig(patch);
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return { patch, result };
    },
    onSuccess: ({ patch }) => {
      // A key change flips OpenAI engine availability in the options payload.
      if (patch.speech?.openai !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: speechSettingsOptionsQueryKey(serverId),
        });
      }
    },
  });
  const { mutate } = mutation;
  const apply = useCallback(
    (patch: MutableDaemonConfigPatch) => {
      mutate(patch);
    },
    [mutate],
  );

  const options = optionsQuery.data ?? null;

  if (!hasFeature) {
    return (
      <SettingsSection title={t("settings.host.speech.sectionTitle")}>
        <View style={settingsStyles.card} testID="host-speech-update-host-card">
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.host.speech.sectionTitle")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.host.speech.updateHost")}</Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    );
  }
  if (!options || !config) {
    if (!optionsQuery.isError) {
      return null;
    }
    return (
      <SettingsSection title={t("settings.host.speech.sectionTitle")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowError}>{t("settings.host.speech.optionsError")}</Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    );
  }

  const speech = config.speech ?? null;
  const keyPatchFailed = mutation.isError && mutation.variables?.speech?.openai !== undefined;
  const speechPatchFailed = mutation.isError && !keyPatchFailed;
  return (
    <>
      <SettingsSection title={t("settings.host.speech.dictationSectionTitle")}>
        <DictationCard speech={speech} options={options} apply={apply} />
      </SettingsSection>
      <SettingsSection title={t("settings.host.speech.voiceSectionTitle")}>
        <VoiceModeCard
          serverId={serverId}
          speech={speech}
          options={options}
          apply={apply}
          showError={speechPatchFailed}
        />
      </SettingsSection>
      {usesOpenAiEngine(speech) ? (
        <SettingsSection title={t("settings.host.speech.openaiSectionTitle")}>
          <OpenAiKeyCard speech={speech} apply={apply} showError={keyPatchFailed} />
        </SettingsSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowWithBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  triggerAnchor: {
    maxWidth: "60%",
    // Keep the dropdown clear of a preceding trailing control (e.g. the voice
    // preview button) so its hover surface never overlaps the combobox.
    marginLeft: theme.spacing[2],
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerActive: {
    borderColor: theme.colors.borderAccent,
  },
  triggerText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  triggerPlaceholder: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  keyInput: {
    flexGrow: 1,
    flexShrink: 1,
    // Fills up to its cap then centers when the row stacks on the narrowest
    // widths, instead of collapsing to content width.
    width: { xs: "100%", sm: "auto" },
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, styles.rowWithBorder];
const ROW_RESPONSIVE_WITH_BORDER = [settingsStyles.rowResponsive, styles.rowWithBorder];
