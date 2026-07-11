// Agent Personalities editor — the per-host roster of named agent templates
// (provider->model, canonical effort, mode, personality prompt, roles, and two
// spinner colors). Lives in the host settings "Agents" section.
//
// i18n: copy here is English-only pending a translation pass (build-first,
// translate-last). Do not add keys to the locale resources for this surface yet.
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type {
  AgentPersonality,
  AgentPersonalityVoice,
  PersonalityRole,
  SpeechSettingsOptions,
} from "@otto-code/protocol/messages";
import { PERSONALITY_ROLES } from "@otto-code/protocol/messages";
import { DEFAULT_AGENT_PERSONALITIES } from "@otto-code/protocol/default-personalities";
import {
  checkPersonalityAvailability,
  normalizePersonalityRoles,
} from "@otto-code/protocol/agent-personalities";
import { EFFORT_LEVELS } from "@otto-code/protocol/effort";
import { ChevronDown, Pencil, Plus, Trash2 } from "@/components/icons/material-icons";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { BlobLoader } from "@/components/blob-loader";
import { Button } from "@/components/ui/button";
import { ColorWheelPicker } from "@/components/ui/color-wheel-picker";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useSpeechSettingsFeature,
  useSpeechSettingsOptions,
} from "@/screens/settings/speech-settings-cards";
import { useTtsPreviewFeature, VoicePreviewButton } from "@/screens/settings/voice-preview-button";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

/**
 * The single detection point for the agent personalities capability.
 * COMPAT(agentPersonalities): added in v0.4.6, drop the gate when daemon floor >= v0.4.6.
 */
export function useAgentPersonalitiesFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentPersonalities === true,
  );
}

const DEFAULT_GLOW_A = "#4ec4ff";
const DEFAULT_GLOW_B = "#e14fe8";

// Personality names are single-word "handles" — short, and restricted to
// letters, digits, hyphen, and underscore — so an agent is trivially
// recognizable at a glance (in the roster, spinner tooltips, and spawn-by-name
// tooling) and safe to round-trip through it. Blocking whitespace and structural
// characters (delimiters like | / :, quotes, emoji, control chars) keeps a name
// from breaking a delimited encoding or a token-boundary reference, while still
// allowing readable names like `code-reviewer` or `fire_storm`. We enforce this
// at the authoring surface (the wire schema stays a permissive `string` for
// protocol back-compat), sanitizing as the user types so an out-of-limit name
// can never be entered in the first place.
const MAX_PERSONALITY_NAME_LENGTH = 20;

function sanitizePersonalityName(value: string): string {
  // Keep only the handle charset (drops whitespace and every special char), then
  // cap the length.
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_PERSONALITY_NAME_LENGTH);
}

const ROLE_LABELS: Record<PersonalityRole, string> = {
  chatter: "Chatter",
  artificer: "Artificer",
  scheduler: "Scheduler",
  worker: "Worker",
  judger: "Judger",
  advisor: "Advisor",
  orchestrator: "Orchestrator",
};

const ROLE_HINTS: Record<PersonalityRole, string> = {
  chatter: "Interactive agent chats",
  artificer: "Creating & managing artifacts",
  scheduler: "Creating & managing schedules",
  worker: "Spawned as a sub-agent",
  judger: "Judging / review passes",
  advisor: "Planning / second opinion (read-only)",
  orchestrator: "Drives multi-agent workflows",
};

interface PersonalityDraft {
  name: string;
  provider: string;
  model: string;
  modeId: string; // "" = provider default
  effortLevel: string; // "" = none
  personalityPrompt: string;
  respectGlobalAppendPrompt: boolean;
  roles: PersonalityRole[];
  glowA: string;
  glowB: string;
  voice: AgentPersonalityVoice | null;
}

// Voice options ride the wire as { provider, model, name }; the picker encodes
// that triple into a single combobox id (voice names never contain "|").
const VOICE_NONE = "";

function encodeVoice(voice: AgentPersonalityVoice | null): string {
  return voice ? `${voice.provider}|${voice.model}|${voice.name}` : VOICE_NONE;
}

// Builds a short spoken introduction for the voice-preview button from the
// personality's name and prompt — plain string templating, no model call. The
// prompt's first sentence (capped) supplies personality flavor when present.
function buildPersonalityIntro(name: string, personalityPrompt: string): string {
  const cleanName = name.trim() || "your agent";
  const prompt = personalityPrompt.trim();
  if (!prompt) {
    return `Hi, I'm ${cleanName}. Ready when you are.`;
  }
  const firstSentence = prompt.split(/(?<=[.!?])\s+/)[0] ?? prompt;
  const flavor =
    firstSentence.length > 140 ? `${firstSentence.slice(0, 137).trimEnd()}…` : firstSentence;
  return `Hi, I'm ${cleanName}. ${flavor}`;
}

function decodeVoice(id: string): AgentPersonalityVoice | null {
  if (!id) return null;
  const [provider, model, name] = id.split("|");
  if (!provider || !model || !name) return null;
  return { provider, model, name };
}

function buildVoiceOptions(options: SpeechSettingsOptions | null): ComboboxOption[] {
  const result: ComboboxOption[] = [{ id: VOICE_NONE, label: "None (host default)" }];
  if (!options) return result;
  for (const model of options.local.ttsModels) {
    for (const name of model.voices) {
      result.push({
        id: `local|${model.id}|${name}`,
        label: `${name} · ${model.label ?? model.id}`,
      });
    }
  }
  if (options.openai.configured) {
    for (const model of options.openai.ttsModels) {
      for (const name of options.openai.ttsVoices) {
        result.push({ id: `openai|${model}|${name}`, label: `${name} · ${model}` });
      }
    }
  }
  return result;
}

function generatePersonalityId(): string {
  return `personality_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function formatEffortLabel(level: string): string {
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatRolesSummary(roles: readonly PersonalityRole[]): string {
  if (roles.length === PERSONALITY_ROLES.length) return "All roles";
  if (roles.length === 0) return "No roles";
  return roles.map((role) => ROLE_LABELS[role]).join(", ");
}

function personalityToDraft(personality: AgentPersonality): PersonalityDraft {
  return {
    name: personality.name,
    provider: personality.provider,
    model: personality.model,
    modeId: personality.modeId ?? "",
    effortLevel: personality.effortLevel ?? "",
    personalityPrompt: personality.personalityPrompt ?? "",
    respectGlobalAppendPrompt: personality.respectGlobalAppendPrompt ?? true,
    roles: normalizePersonalityRoles(personality.roles),
    glowA: personality.spinner?.glowA ?? DEFAULT_GLOW_A,
    glowB: personality.spinner?.glowB ?? DEFAULT_GLOW_B,
    voice: personality.voice ?? null,
  };
}

function draftToPersonality(draft: PersonalityDraft, id: string): AgentPersonality {
  const personality: AgentPersonality = {
    id,
    name: draft.name.trim(),
    provider: draft.provider,
    model: draft.model,
    respectGlobalAppendPrompt: draft.respectGlobalAppendPrompt,
    roles: draft.roles,
    spinner: { glowA: draft.glowA.trim(), glowB: draft.glowB.trim() },
  };
  if (draft.effortLevel) {
    personality.effortLevel = draft.effortLevel;
  }
  if (draft.modeId) {
    personality.modeId = draft.modeId;
  }
  const prompt = draft.personalityPrompt.trim();
  if (prompt) {
    personality.personalityPrompt = prompt;
  }
  if (draft.voice) {
    personality.voice = draft.voice;
  }
  return personality;
}

function selectableProviders(entries: readonly ProviderSnapshotEntry[]): ProviderSnapshotEntry[] {
  return entries.filter((entry) => entry.enabled !== false);
}

function defaultModelForProvider(entry: ProviderSnapshotEntry | undefined): string {
  const models = entry?.models ?? [];
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
}

function emptyDraft(entries: readonly ProviderSnapshotEntry[]): PersonalityDraft {
  const provider = selectableProviders(entries)[0];
  const providerId = provider?.provider ?? "";
  return {
    name: "",
    provider: providerId,
    model: defaultModelForProvider(provider),
    modeId: "",
    effortLevel: "medium",
    personalityPrompt: "",
    respectGlobalAppendPrompt: true,
    // A new personality is available everywhere by default; the user narrows it.
    roles: [...PERSONALITY_ROLES],
    glowA: DEFAULT_GLOW_A,
    glowB: DEFAULT_GLOW_B,
    voice: null,
  };
}

// Themed icons + shared prop constants (module scope so they are stable props).
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPlus = withUnistyles(Plus);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);

const chevronMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const iconMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const iconForegroundMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const iconDestructiveMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
  size: theme.iconSize.sm,
});

const CHEVRON_ICON = <ThemedChevronDown uniProps={chevronMapping} />;

const FLEX_1 = { flex: 1 } as const;

// ---------------------------------------------------------------------------
// Icon button — hover chrome + tooltip, the app's canonical icon-only affordance
// (mirrors file-view-mode-bar). The ghost Button variant only recolors its icon,
// so icon-only actions use this instead to get a real hover surface.
// ---------------------------------------------------------------------------

type ThemedIcon = typeof ThemedPlus;

interface IconButtonProps {
  Icon: ThemedIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
}

function IconButton({
  Icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
  testID,
}: IconButtonProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const active = hovered && !disabled;
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.iconButton,
      (active || pressed) && styles.iconButtonHovered,
      disabled && styles.iconButtonDisabled,
    ],
    [active, disabled],
  );
  let mapping = iconMutedMapping;
  if (destructive) {
    mapping = iconDestructiveMapping;
  } else if (active) {
    mapping = iconForegroundMapping;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={triggerStyle}
        testID={testID}
      >
        <Icon uniProps={mapping} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const EMPTY_STATS: Record<string, number> = {};

function personalityStatsQueryKey(serverId: string): [string, string] {
  return ["agent-personality-stats", serverId];
}

// Per-personality spawn counts, served from a daemon stats file (decoupled from
// the config broadcast). Refetched when the section mounts / regains focus.
function usePersonalityStats(serverId: string, enabled: boolean): Record<string, number> {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: personalityStatsQueryKey(serverId),
    enabled: enabled && Boolean(client && isConnected),
    dataShape: "value",
    staleTimeMs: 30 * 1000,
    queryFn: async (): Promise<Record<string, number>> => {
      if (!client) {
        return EMPTY_STATS;
      }
      const result = await client.getPersonalityStats();
      return result.stats;
    },
  });
  return query.data ?? EMPTY_STATS;
}

export function AgentPersonalitiesSection({ serverId }: { serverId: string }): ReactElement | null {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useAgentPersonalitiesFeature(serverId);
  const usageStats = usePersonalityStats(serverId, isConnected && hasFeature);
  const hasSpeechFeature = useSpeechSettingsFeature(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { entries } = useProvidersSnapshot(serverId, { enabled: isConnected && hasFeature });
  const speechOptionsQuery = useSpeechSettingsOptions(
    serverId,
    isConnected && hasFeature && hasSpeechFeature,
  );
  const speechOptions = speechOptionsQuery.data ?? null;

  const [editing, setEditing] = useState<{ id: string | null; draft: PersonalityDraft } | null>(
    null,
  );

  const personalities = useMemo(() => config?.agentPersonalities?.personalities ?? [], [config]);
  const providerEntries = useMemo(() => entries ?? [], [entries]);

  const savePersonalities = useCallback(
    async (next: AgentPersonality[]) => {
      await patchConfig({ agentPersonalities: { personalities: next } });
    },
    [patchConfig],
  );

  const handleAdd = useCallback(() => {
    setEditing({ id: null, draft: emptyDraft(providerEntries) });
  }, [providerEntries]);

  const handleEdit = useCallback(
    (id: string) => {
      const personality = personalities.find((entry) => entry.id === id);
      if (!personality) return;
      setEditing({ id, draft: personalityToDraft(personality) });
    },
    [personalities],
  );

  const handleClose = useCallback(() => setEditing(null), []);

  const handleSave = useCallback(
    async (draft: PersonalityDraft) => {
      if (!editing) return;
      const id = editing.id ?? generatePersonalityId();
      const next = editing.id
        ? personalities.map((entry) =>
            entry.id === editing.id ? draftToPersonality(draft, id) : entry,
          )
        : [...personalities, draftToPersonality(draft, id)];
      try {
        await savePersonalities(next);
        setEditing(null);
      } catch (error) {
        Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
      }
    },
    [editing, personalities, savePersonalities],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const personality = personalities.find((entry) => entry.id === id);
      if (!personality) return;
      void (async () => {
        const confirmed = await confirmDialog({
          title: "Delete personality",
          message: `Delete "${personality.name}"? Anything set to use it will stop working.`,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          destructive: true,
        });
        if (!confirmed) return;
        try {
          await savePersonalities(personalities.filter((entry) => entry.id !== id));
        } catch (error) {
          Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [personalities, savePersonalities],
  );

  // The shipped starter team is seeded automatically on a fresh host; this
  // button re-adds any builtin the user has since deleted (matched by stable id,
  // so kept/renamed ones are never duplicated). Missing count drives the label
  // and the disabled state.
  const missingDefaultsCount = useMemo(() => {
    const existingIds = new Set(personalities.map((entry) => entry.id));
    return DEFAULT_AGENT_PERSONALITIES.filter((entry) => !existingIds.has(entry.id)).length;
  }, [personalities]);

  const handleRestoreDefaults = useCallback(async () => {
    const existingIds = new Set(personalities.map((entry) => entry.id));
    const missing = DEFAULT_AGENT_PERSONALITIES.filter((entry) => !existingIds.has(entry.id));
    if (missing.length === 0) return;
    try {
      await savePersonalities([...personalities, ...missing]);
    } catch (error) {
      Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
    }
  }, [personalities, savePersonalities]);

  const restoreDisabled = !isConnected || !config || missingDefaultsCount === 0;

  const addButton = useMemo(
    () => (
      <IconButton
        Icon={ThemedPlus}
        label="Add personality"
        onPress={handleAdd}
        disabled={!isConnected || !config}
        testID="agent-personalities-add-button"
      />
    ),
    [handleAdd, isConnected, config],
  );

  if (!isConnected || !hasFeature) {
    return null;
  }

  return (
    <>
      <SettingsSection
        title="Agent personalities"
        trailing={addButton}
        testID="agent-personalities-section"
      >
        <View style={settingsStyles.card} testID="agent-personalities-card">
          {personalities.length > 0 ? (
            personalities.map((personality, index) => (
              <PersonalityRow
                key={personality.id}
                personality={personality}
                entries={providerEntries}
                isFirst={index === 0}
                usageCount={usageStats[personality.id] ?? 0}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No personalities yet. Add one to spawn agents by name with a fixed provider, model,
                effort, and prompt — or bring back the starter team.
              </Text>
              <Button
                variant="secondary"
                onPress={handleRestoreDefaults}
                disabled={restoreDisabled}
                style={styles.restoreButton}
                testID="agent-personalities-restore-button"
              >
                {`Add starter team (${DEFAULT_AGENT_PERSONALITIES.length})`}
              </Button>
            </View>
          )}
        </View>
        {personalities.length > 0 && missingDefaultsCount > 0 ? (
          <View style={styles.restoreFooter}>
            <Button
              variant="ghost"
              onPress={handleRestoreDefaults}
              disabled={restoreDisabled}
              testID="agent-personalities-restore-button"
            >
              {`Restore starter team (${missingDefaultsCount} missing)`}
            </Button>
          </View>
        ) : null}
      </SettingsSection>

      {editing ? (
        <PersonalityEditModal
          title={editing.id ? "Edit personality" : "Add personality"}
          serverId={serverId}
          initialDraft={editing.draft}
          entries={providerEntries}
          speechOptions={speechOptions}
          onClose={handleClose}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface PersonalityRowProps {
  personality: AgentPersonality;
  entries: readonly ProviderSnapshotEntry[];
  isFirst: boolean;
  usageCount: number;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatUsageCount(count: number): string {
  if (count <= 0) {
    return "Never used";
  }
  return count === 1 ? "Used once" : `Used ${count} times`;
}

function PersonalityRow({
  personality,
  entries,
  isFirst,
  usageCount,
  onEdit,
  onRemove,
}: PersonalityRowProps): ReactElement {
  const handleEdit = useCallback(() => onEdit(personality.id), [onEdit, personality.id]);
  const handleRemove = useCallback(() => onRemove(personality.id), [onRemove, personality.id]);

  const entry = entries.find((candidate) => candidate.provider === personality.provider);
  const availability = checkPersonalityAvailability(personality, {
    providerStatus: entry?.status,
    providerEnabled: entry?.enabled,
    modelIds: entry?.models?.map((model) => model.id),
    modeIds: entry?.modes?.map((mode) => mode.id),
  });

  // Show the display labels the dropdowns use, not the raw ids. Fall back to the
  // stored id when the provider/model is no longer available to resolve a label.
  const providerLabel = entry?.label ?? personality.provider;
  const modelLabel =
    entry?.models?.find((model) => model.id === personality.model)?.label ?? personality.model;

  const roles = normalizePersonalityRoles(personality.roles);
  const rolesSummary = formatRolesSummary(roles);

  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && styles.rowBorder, styles.row],
    [isFirst],
  );
  const contentStyle = useMemo(
    () => [settingsStyles.rowContent, !availability.available && styles.dimmed],
    [availability.available],
  );

  return (
    <View style={rowStyle} testID={`agent-personality-row-${personality.id}`}>
      <BlobLoader size={18} glowA={personality.spinner?.glowA} glowB={personality.spinner?.glowB} />
      <View style={contentStyle}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {providerLabel} · {modelLabel} · {rolesSummary} · {formatUsageCount(usageCount)}
        </Text>
        {!availability.available ? (
          <Text style={styles.unavailableText} numberOfLines={2}>
            Unavailable — {availability.reason}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowActions}>
        <IconButton
          Icon={ThemedPencil}
          label="Edit personality"
          onPress={handleEdit}
          testID={`agent-personality-edit-${personality.id}`}
        />
        <IconButton
          Icon={ThemedTrash}
          label="Delete personality"
          destructive
          onPress={handleRemove}
          testID={`agent-personality-remove-${personality.id}`}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Editor modal
// ---------------------------------------------------------------------------

interface PersonalityEditModalProps {
  title: string;
  serverId: string;
  initialDraft: PersonalityDraft;
  entries: readonly ProviderSnapshotEntry[];
  speechOptions: SpeechSettingsOptions | null;
  onClose: () => void;
  onSave: (draft: PersonalityDraft) => void;
}

function PersonalityEditModal({
  title,
  serverId,
  initialDraft,
  entries,
  speechOptions,
  onClose,
  onSave,
}: PersonalityEditModalProps): ReactElement {
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  const [draft, setDraft] = useState<PersonalityDraft>(initialDraft);
  const [isSaving, setIsSaving] = useState(false);

  const providerEntry = entries.find((entry) => entry.provider === draft.provider);

  const providerOptions = useMemo<ComboboxOption[]>(
    () =>
      selectableProviders(entries).map((entry) => ({
        id: entry.provider,
        label: entry.label ?? entry.provider,
      })),
    [entries],
  );
  const modelOptions = useMemo<ComboboxOption[]>(
    () =>
      (providerEntry?.models ?? []).map((model) => ({
        id: model.id,
        label: model.label ?? model.id,
      })),
    [providerEntry],
  );
  const modeOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: "", label: "Provider default" },
      ...(providerEntry?.modes ?? []).map((mode) => ({
        id: mode.id,
        label: mode.label ?? mode.id,
      })),
    ],
    [providerEntry],
  );
  const effortOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: "", label: "None" },
      ...EFFORT_LEVELS.map((level) => ({ id: level, label: formatEffortLabel(level) })),
    ],
    [],
  );
  const voiceOptions = useMemo(() => buildVoiceOptions(speechOptions), [speechOptions]);
  // Only offer a voice when the host actually exposes TTS voices beyond "None".
  const showVoice = voiceOptions.length > 1;
  const voicePreview = useMemo(
    () =>
      canPreviewVoice ? (
        <VoicePreviewButton
          serverId={serverId}
          text={buildPersonalityIntro(draft.name, draft.personalityPrompt)}
          voiceName={draft.voice?.name}
          voiceModel={draft.voice?.model}
          voiceProvider={draft.voice?.provider}
          testID="agent-personality-voice-preview"
        />
      ) : undefined,
    [canPreviewVoice, serverId, draft.name, draft.personalityPrompt, draft.voice],
  );

  const header = useMemo(() => ({ title }), [title]);

  const handleProviderChange = useCallback(
    (nextProvider: string) => {
      const nextEntry = entries.find((entry) => entry.provider === nextProvider);
      setDraft((current) => ({
        ...current,
        provider: nextProvider,
        model: defaultModelForProvider(nextEntry),
        modeId: "",
      }));
    },
    [entries],
  );

  const setName = useCallback((value: string) => {
    setDraft((current) => ({ ...current, name: sanitizePersonalityName(value) }));
  }, []);
  const setModel = useCallback((value: string) => {
    setDraft((current) => ({ ...current, model: value }));
  }, []);
  const setMode = useCallback((value: string) => {
    setDraft((current) => ({ ...current, modeId: value }));
  }, []);
  const setEffort = useCallback((value: string) => {
    setDraft((current) => ({ ...current, effortLevel: value }));
  }, []);
  const setPrompt = useCallback((value: string) => {
    setDraft((current) => ({ ...current, personalityPrompt: value }));
  }, []);
  const setRespectAppend = useCallback((value: boolean) => {
    setDraft((current) => ({ ...current, respectGlobalAppendPrompt: value }));
  }, []);
  const setGlowA = useCallback((value: string) => {
    setDraft((current) => ({ ...current, glowA: value }));
  }, []);
  const setGlowB = useCallback((value: string) => {
    setDraft((current) => ({ ...current, glowB: value }));
  }, []);
  const setVoice = useCallback((id: string) => {
    setDraft((current) => ({ ...current, voice: decodeVoice(id) }));
  }, []);

  const toggleRole = useCallback((role: PersonalityRole) => {
    setDraft((current) => {
      const has = current.roles.includes(role);
      const nextRoles = has
        ? current.roles.filter((entry) => entry !== role)
        : PERSONALITY_ROLES.filter((entry) => entry === role || current.roles.includes(entry));
      return { ...current, roles: nextRoles };
    });
  }, []);

  const setAllRoles = useCallback((all: boolean) => {
    setDraft((current) => ({ ...current, roles: all ? [...PERSONALITY_ROLES] : [] }));
  }, []);

  const canSave = draft.name.trim().length > 0 && Boolean(draft.provider) && Boolean(draft.model);

  const handleSave = useCallback(() => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    onSave(draft);
    // The parent unmounts this modal on success; reset defensively if a save
    // error keeps it mounted.
    setIsSaving(false);
  }, [canSave, draft, isSaving, onSave]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      webScrollbar
      testID="agent-personality-edit-modal"
    >
      <View style={styles.editorBody}>
        <FieldLabel label="Name" />
        <TextInput
          value={draft.name}
          onChangeText={setName}
          placeholder="e.g. Sparky"
          placeholderTextColor={styles.placeholder.color}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_PERSONALITY_NAME_LENGTH}
          style={styles.textInput}
          testID="agent-personality-name-input"
        />
        <Text style={styles.fieldHint}>
          One word — letters, numbers, - or _ — up to {MAX_PERSONALITY_NAME_LENGTH} characters.
        </Text>

        <PickerRow
          label="Provider"
          value={draft.provider}
          options={providerOptions}
          onChange={handleProviderChange}
          testID="agent-personality-provider-picker"
        />
        <PickerRow
          label="Model"
          value={draft.model}
          options={modelOptions}
          onChange={setModel}
          testID="agent-personality-model-picker"
        />
        <PickerRow
          label="Mode"
          value={draft.modeId}
          options={modeOptions}
          onChange={setMode}
          testID="agent-personality-mode-picker"
        />
        <PickerRow
          label="Effort"
          value={draft.effortLevel}
          options={effortOptions}
          onChange={setEffort}
          testID="agent-personality-effort-picker"
        />

        <FieldLabel label="Personality prompt" />
        <TextInput
          value={draft.personalityPrompt}
          onChangeText={setPrompt}
          placeholder="How this personality should behave (fun, optional)."
          placeholderTextColor={styles.placeholder.color}
          multiline
          style={styles.textArea}
          testID="agent-personality-prompt-input"
        />

        <View style={styles.toggleRow}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Respect global append prompt</Text>
            <Text style={settingsStyles.rowHint}>
              When off, the personality prompt stands alone (no host-wide append stacked on top).
            </Text>
          </View>
          <Switch value={draft.respectGlobalAppendPrompt} onValueChange={setRespectAppend} />
        </View>

        <RolesField roles={draft.roles} onToggle={toggleRole} onSetAll={setAllRoles} />

        <SpinnerField
          glowA={draft.glowA}
          glowB={draft.glowB}
          onGlowAChange={setGlowA}
          onGlowBChange={setGlowB}
        />

        {showVoice ? (
          <PickerRow
            label="Voice"
            value={encodeVoice(draft.voice)}
            options={voiceOptions}
            onChange={setVoice}
            testID="agent-personality-voice-picker"
            trailing={voicePreview}
          />
        ) : null}

        <View style={styles.editorActions}>
          <Button variant="secondary" size="sm" style={FLEX_1} onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            style={FLEX_1}
            onPress={handleSave}
            disabled={!canSave || isSaving}
            testID="agent-personality-save-button"
          >
            Save
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-fields
// ---------------------------------------------------------------------------

function FieldLabel({ label }: { label: string }): ReactElement {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

interface PickerRowProps {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (next: string) => void;
  testID: string;
  // Optional control rendered just left of the dropdown (e.g. a preview button).
  trailing?: ReactNode;
}

function PickerRow({
  label,
  value,
  options,
  onChange,
  testID,
  trailing,
}: PickerRowProps): ReactElement {
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
    <View style={styles.pickerRow}>
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
            {triggerLabel || "Select"}
          </Text>
          {CHEVRON_ICON}
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

interface RolesFieldProps {
  roles: PersonalityRole[];
  onToggle: (role: PersonalityRole) => void;
  onSetAll: (all: boolean) => void;
}

function RolesField({ roles, onToggle, onSetAll }: RolesFieldProps): ReactElement {
  const allSelected = roles.length === PERSONALITY_ROLES.length;
  const handleToggleAll = useCallback(() => onSetAll(!allSelected), [onSetAll, allSelected]);
  return (
    <View style={styles.rolesField}>
      <View style={styles.rolesHeader}>
        <FieldLabel label="Roles" />
        <Button
          variant="ghost"
          size="sm"
          onPress={handleToggleAll}
          testID="agent-personality-roles-all-toggle"
        >
          {allSelected ? "None" : "All"}
        </Button>
      </View>
      <View style={styles.roleChips}>
        {PERSONALITY_ROLES.map((role) => (
          <RoleChip key={role} role={role} selected={roles.includes(role)} onToggle={onToggle} />
        ))}
      </View>
    </View>
  );
}

interface RoleChipProps {
  role: PersonalityRole;
  selected: boolean;
  onToggle: (role: PersonalityRole) => void;
}

function RoleChip({ role, selected, onToggle }: RoleChipProps): ReactElement {
  const handlePress = useCallback(() => onToggle(role), [onToggle, role]);
  const chipStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.chip,
      selected && styles.chipSelected,
      pressed && styles.chipPressed,
    ],
    [selected],
  );
  const a11yState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      style={chipStyle}
      accessibilityRole="button"
      accessibilityState={a11yState}
      accessibilityLabel={`${ROLE_LABELS[role]} — ${ROLE_HINTS[role]}`}
      testID={`agent-personality-role-${role}`}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText}>{ROLE_LABELS[role]}</Text>
    </Pressable>
  );
}

interface SpinnerFieldProps {
  glowA: string;
  glowB: string;
  onGlowAChange: (next: string) => void;
  onGlowBChange: (next: string) => void;
}

// Small, always-visible wheels sit side by side; keep them compact so both fit
// on a phone-width modal without scrolling the editor.
const SPINNER_WHEEL_SIZE = 120;

function SpinnerField({
  glowA,
  glowB,
  onGlowAChange,
  onGlowBChange,
}: SpinnerFieldProps): ReactElement {
  return (
    <View style={styles.spinnerField}>
      <View style={styles.spinnerHeader}>
        <FieldLabel label="Spinner colors" />
        <BlobLoader size={20} glowA={glowA} glowB={glowB} />
      </View>
      <View style={styles.spinnerWheels}>
        <ColorInput
          label="Glow A"
          value={glowA}
          onChange={onGlowAChange}
          testID="agent-personality-glow-a-input"
        />
        <ColorInput
          label="Glow B"
          value={glowB}
          onChange={onGlowBChange}
          testID="agent-personality-glow-b-input"
        />
      </View>
    </View>
  );
}

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testID: string;
}

function ColorInput({ label, value, onChange, testID }: ColorInputProps): ReactElement {
  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: value }], [value]);
  return (
    <View style={styles.colorInputColumn}>
      <Text style={styles.colorInputLabel}>{label}</Text>
      <ColorWheelPicker
        value={value}
        onChange={onChange}
        size={SPINNER_WHEEL_SIZE}
        testID={`${testID}-wheel`}
      />
      <View style={styles.colorInput}>
        <View style={swatchStyle} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="#4ec4ff"
          placeholderTextColor={styles.placeholder.color}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.colorTextInput}
          accessibilityLabel={label}
          testID={testID}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[3],
    alignItems: "center",
  },
  rowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  iconButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonDisabled: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  dimmed: {
    opacity: 0.55,
  },
  unavailableText: {
    marginTop: theme.spacing[1],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  emptyCard: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
  },
  restoreButton: {
    marginTop: theme.spacing[3],
    alignSelf: "flex-start",
  },
  restoreFooter: {
    marginTop: theme.spacing[2],
    alignItems: "flex-start",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  editorBody: {
    gap: theme.spacing[3],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldHint: {
    marginTop: -theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  textInput: {
    minHeight: 40,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  textArea: {
    minHeight: 88,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlignVertical: "top",
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
  },
  triggerAnchor: {
    maxWidth: "60%",
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
    backgroundColor: theme.colors.surface2,
  },
  triggerActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surfaceHover,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rolesField: {
    gap: theme.spacing[2],
  },
  rolesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roleChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  chipSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chipTextSelected: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  spinnerField: {
    gap: theme.spacing[2],
  },
  spinnerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  spinnerWheels: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  colorInputColumn: {
    flex: 1,
    gap: theme.spacing[2],
    alignItems: "center",
  },
  colorInputLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  colorInput: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  colorTextInput: {
    flex: 1,
    minHeight: 34,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  editorActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
}));
