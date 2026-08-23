// Agent Personalities editor - the per-host roster of named agent templates
// (provider->model, canonical effort, mode, personality prompt, roles, and two
// spinner colors). Lives in the host settings "Agents" section.
//
// i18n: copy here is English-only pending a translation pass (build-first,
// translate-last). Do not add keys to the locale resources for this surface yet.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type {
  AgentProfile,
  AgentPersonalityVoice,
  CueMoment,
  PersonalityRole,
  SpeechSettingsOptions,
} from "@otto-code/protocol/messages";
import { CUE_MOMENTS, PERSONALITY_ROLES } from "@otto-code/protocol/messages";
import { DEFAULT_AGENT_PROFILES } from "@otto-code/protocol/default-personalities";
import {
  DEFAULT_GLOW_A,
  DEFAULT_GLOW_B,
  draftToPersonality,
  draftVoiceCuesAreEmpty,
  emptyDraftVoiceCues,
  newCueLine,
  personalityToDraft,
  type CueLineDraft,
  type DraftVoiceCues,
  type PersonalityDraft,
} from "./personality-draft";
import {
  checkPersonalityAvailability,
  normalizePersonalityRoles,
} from "@otto-code/protocol/agent-personalities";
import { EFFORT_LEVELS } from "@otto-code/protocol/effort";
import { isUserSelectableMode } from "@otto-code/protocol/provider-manifest";
import { ChevronDown, Pencil, Plus, Robot, Trash2 } from "@/components/icons/material-icons";
import { AgentProfileGlyph } from "@/agent-profiles/internal/agent-profile-glyph";
import { AgentProfileAppearanceField } from "@/agent-profiles/settings/agent-profile-appearance-field";
import { BlobLoader } from "@/components/blob-loader";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { Button } from "@/components/ui/button";
import { ColorWheelPicker } from "@/components/ui/color-wheel-picker";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { type SegmentedControlOption } from "@/components/ui/segmented-control";
import { TabbedModalSheet } from "@/components/ui/tabbed-modal-sheet";
import { Switch } from "@/components/ui/switch";
import { TextArea } from "@/components/ui/text-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useAppSettings } from "@/hooks/use-settings";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useSpeechSettingsFeature,
  useSpeechSettingsOptions,
} from "@/screens/settings/speech-settings-cards";
import { useTtsPreviewFeature, VoicePreviewButton } from "@/screens/settings/voice-preview-button";
import {
  coerceModeForModel,
  filterModesForModel,
  findModelDefinition,
} from "@/provider-selection/mode-support";
import { ROLE_HINTS, ROLE_LABELS } from "@/provider-selection/role-labels";
import { useIsExtraCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import {
  usePersonalityMemoryCounts,
  usePersonalityMemoryEnabled,
  usePersonalityMemoryTransfer,
} from "@/context-management/use-personality-memory";
import {
  PersonalityMemoryTransferSheet,
  type MemoryTransferChoice,
} from "./personality-memory-transfer-sheet";

/**
 * The single detection point for the agent personalities capability.
 * COMPAT(agentPersonalities): added in v0.5.0, drop the gate when daemon floor >= v0.5.0.
 */
export function useAgentPersonalitiesFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentPersonalities === true,
  );
}

/**
 * Whether the host can author voice-cue lines (the Writer chain). Playback in
 * the Visualizer separately requires ttsPreview; this only gates the editor's
 * "Generate" action + save-time auto-generation.
 * COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when floor >= v0.6.3.
 */
export function useVisualizerVoiceCuesFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.visualizerVoiceCues === true,
  );
}

/**
 * Whether the host can author a personality profile (the prompt prose) from a
 * draft's name, roles, and spinner colors. Gates the Personality tab's
 * "Generate with AI" action only. A host without it keeps the hand-written
 * field, which is how every personality was authored before.
 * COMPAT(personalityProfile): added in v0.7.5, drop the gate when floor >= v0.7.5.
 */
export function usePersonalityProfileFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.personalityProfile === true,
  );
}

// Personality names are single-word "handles" - short, and restricted to
// letters, digits, hyphen, and underscore - so an agent is trivially
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

// Spinner glow colors flow into daemon config, SVG gradients, and the
// BlobLoader, so hand-typed text must be a real hex color before it can be
// saved. The color wheel always emits valid values; this only guards free text.
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim());
}

// Merge freshly generated lines into a PERSISTED personality's cues, filling
// only moments that are still empty - never clobbering lines the user added
// after saving. Returns null when nothing changed (every produced moment was
// already populated) so the caller can skip the write. Used by the background
// cue generation that runs after a cue-less personality is saved.
function fillEmptyPersistedCues(
  current: AgentProfile["voiceCues"],
  generated: Partial<Record<CueMoment, string[]>>,
): AgentProfile["voiceCues"] | null {
  // Mirror the wire type rather than `Record<string, string[]>`: the cues schema
  // is a passthrough object, so its inferred type carries an `unknown` index
  // signature that a plain string[] record cannot accept.
  const next: NonNullable<AgentProfile["voiceCues"]> = { ...current };
  let added = false;
  for (const moment of CUE_MOMENTS) {
    const existing = next[moment];
    const lines = generated[moment];
    if ((!existing || existing.length === 0) && lines && lines.length > 0) {
      next[moment] = lines;
      added = true;
    }
  }
  if (!added) {
    return null;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// The editor is split into tabs (the form grew long). Identity = who it is,
// Model = its brain, Voice = spoken voice + the voice-cue lines.
type EditorTab = "identity" | "personality" | "model" | "voice";
const EDITOR_TABS: SegmentedControlOption<EditorTab>[] = [
  { value: "identity", label: "Identity" },
  { value: "personality", label: "Personality" },
  { value: "model", label: "Model" },
  { value: "voice", label: "Voice" },
];

const CUE_KIND_LABELS: Record<CueMoment, string> = {
  join: "Starting",
  thinking: "Thinking",
  waiting: "Waiting",
  done: "Completed",
};

// Distinct examples per moment - a line should sound wrong at the others.
// (The old “All set” example read equally as starting/thinking/done, which is
// exactly the ambiguity the generator now avoids too.)
const CUE_KIND_HINTS: Record<CueMoment, string> = {
  join: "Just picked up the task, about to begin - e.g. “On it”.",
  thinking: "In the middle of working it out - e.g. “I’m thinking…”.",
  waiting: "Its own turn is over but its sub-agents are still running - e.g. “Still hearing back”.",
  done: "Finished, handing back the result - e.g. “Done”.",
};

// Per-moment merge of freshly generated lines into the current draft: only
// moments that actually produced lines are overwritten, so a partial
// generation failure never wipes hand-written lines for the failed moments.
function mergeGeneratedCues(
  current: DraftVoiceCues,
  generated: Partial<Record<CueMoment, string[]>>,
): DraftVoiceCues {
  const next = { ...current };
  for (const moment of CUE_MOMENTS) {
    const lines = generated[moment];
    if (lines && lines.length > 0) {
      next[moment] = lines.map((text) => newCueLine(text));
    }
  }
  return next;
}

// Voice options ride the wire as { provider, model, name }; the picker encodes
// that triple into a single combobox id (voice names never contain "|").
const VOICE_NONE = "";

function encodeVoice(voice: AgentPersonalityVoice | null): string {
  return voice ? `${voice.provider}|${voice.model}|${voice.name}` : VOICE_NONE;
}

// Builds a short spoken introduction for the voice-preview button from the
// personality's name and first role - plain string templating, no model call.
function buildPersonalityIntro(name: string, roles: readonly PersonalityRole[]): string {
  const cleanName = name.trim() || "your agent";
  const firstRole = roles[0];
  const roleLabel = firstRole ? ROLE_LABELS[firstRole].toLowerCase() : "agent";
  return `Hi, I'm ${cleanName}. I am excited to be your ${roleLabel}.`;
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

// Both AI actions in the editor (voice cues, personality profile) need the same
// two things: the host advertising the capability, and a live client to ask.
// Kept as a helper so the modal reads as one call per action.
function canAuthorWithAi(hasFeature: boolean, client: object | null): boolean {
  return hasFeature && client !== null;
}

function generatePersonalityId(): string {
  return `personality_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function formatEffortLabel(level: string): string {
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
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
    effort: "medium",
    personalityPrompt: "",
    notes: "",
    respectGlobalAppendPrompt: true,
    memoryEnabled: true,
    // A new personality is available everywhere by default; the user narrows it.
    roles: [...PERSONALITY_ROLES],
    icon: "",
    color: "",
    glowA: DEFAULT_GLOW_A,
    glowB: DEFAULT_GLOW_B,
    voice: null,
    voiceCues: emptyDraftVoiceCues(),
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
// Icon button - hover chrome + tooltip, the app's canonical icon-only affordance
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

  // Accrued-lesson counts, so a row shows what a personality has learned and a
  // delete can ask about it before destroying it. Read-only here by design:
  // managing entries lives in Context Management, which is the one place that
  // holds everything sent before you type.
  const memoryCounts = usePersonalityMemoryCounts(serverId, isConnected && hasFeature);
  const memoryTransfer = usePersonalityMemoryTransfer(serverId);

  // The roster is `daemon.agentProfiles` - one stored template list, labelled
  // "Personalities" here because the UI label is the one users know. A
  // pre-convergence host's `agents.agentPersonalities` is imported into it once
  // at daemon start, ids intact.
  const personalities = useMemo(() => config?.agentProfiles ?? [], [config]);
  const providerEntries = useMemo(() => entries ?? [], [entries]);

  const savePersonalities = useCallback(
    async (next: AgentProfile[]) => {
      await patchConfig({ agentProfiles: next });
    },
    [patchConfig],
  );

  // Background cue generation resolves after the editor has closed and can lag
  // by seconds, during which the roster may change - read the freshest config
  // at persist time, not a value closed over at render.
  const configRef = useRef(config);
  configRef.current = config;

  // Persist voice cues generated in the background after a cue-less personality
  // was saved. Fills only still-empty moments on the current roster entry, and
  // no-ops if the personality was deleted or the user has since added cues.
  const persistGeneratedCues = useCallback(
    async (personalityId: string, generated: Partial<Record<CueMoment, string[]>>) => {
      const current = configRef.current?.agentProfiles ?? [];
      const target = current.find((entry) => entry.id === personalityId);
      if (!target) {
        return;
      }
      const mergedCues = fillEmptyPersistedCues(target.voiceCues, generated);
      if (!mergedCues) {
        return;
      }
      // Build the replacement once (outside the map) so the swap is a plain
      // reference substitution rather than an allocate-per-iteration spread.
      const updated: AgentProfile = { ...target, voiceCues: mergedCues };
      const next = current.map((entry) => (entry.id === personalityId ? updated : entry));
      await savePersonalities(next);
    },
    [savePersonalities],
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
    async (draft: PersonalityDraft): Promise<AgentProfile | undefined> => {
      if (!editing) return undefined;
      const id = editing.id ?? generatePersonalityId();
      // Draft conversion is inside the try with the save: anything that throws
      // between the click and the write has to reach the user, or the editor
      // just sits there looking stuck.
      try {
        const personality = draftToPersonality(
          draft,
          id,
          personalities.find((entry) => entry.id === editing.id),
        );
        // An edited personality can vanish from the roster mid-edit (deleted
        // from another client); mapping by id would silently drop the save, so
        // append (recreate) it instead.
        const stillExists =
          editing.id !== null && personalities.some((entry) => entry.id === editing.id);
        const next = stillExists
          ? personalities.map((entry) => (entry.id === editing.id ? personality : entry))
          : [...personalities, personality];
        await savePersonalities(next);
        setEditing(null);
        // The saved personality lets the editor kick off (and later persist)
        // background cue generation without blocking this save.
        return personality;
      } catch (error) {
        void alertDialog({
          title: "Unable to save",
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },
    [editing, personalities, savePersonalities],
  );

  // Names are load-bearing keys (spawn-by-name, running-agent selection), so
  // the editor blocks a case-insensitive collision with any other personality.
  const takenNames = useMemo(
    () =>
      personalities
        .filter((entry) => entry.id !== editing?.id)
        .map((entry) => entry.name.trim().toLowerCase()),
    [personalities, editing],
  );

  // A personality with accrued lessons gets a three-way question instead of a
  // yes/no confirm (transfer / discard / cancel), because the lessons are the
  // only part of a personality that took real work to produce and there is no
  // undo. Zero lessons keeps the plain confirm - a decision sheet about nothing
  // is just an extra click.
  const [pendingDelete, setPendingDelete] = useState<{
    personality: AgentProfile;
    lessonCount: number;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deletePersonality = useCallback(
    async (id: string) => {
      try {
        await savePersonalities(personalities.filter((entry) => entry.id !== id));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [personalities, savePersonalities],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const personality = personalities.find((entry) => entry.id === id);
      if (!personality) return;
      const lessonCount = memoryCounts[id] ?? 0;
      if (lessonCount > 0) {
        setDeleteError(null);
        setPendingDelete({ personality, lessonCount });
        return;
      }
      void (async () => {
        const confirmed = await confirmDialog({
          title: "Delete personality",
          message: `Delete "${personality.name}"? Anything set to use it will stop working.`,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          destructive: true,
        });
        if (!confirmed) return;
        const failure = await deletePersonality(id);
        if (failure) {
          void alertDialog({ title: "Unable to save", message: failure });
        }
      })();
    },
    [deletePersonality, memoryCounts, personalities],
  );

  const handleMemoryChoice = useCallback(
    (choice: MemoryTransferChoice) => {
      const target = pendingDelete;
      if (!target) return;
      setDeleteBusy(true);
      setDeleteError(null);
      void (async () => {
        try {
          // Memory first, roster second. Reversing this order would delete the
          // owner of a store nobody can then hand over.
          const transferFailure = await memoryTransfer.run({
            fromPersonalityId: target.personality.id,
            ...(choice.kind === "transfer" ? { toPersonalityId: choice.toPersonalityId } : {}),
            mode: choice.kind,
          });
          if (transferFailure) {
            setDeleteError(transferFailure);
            return;
          }
          const deleteFailure = await deletePersonality(target.personality.id);
          if (deleteFailure) {
            setDeleteError(deleteFailure);
            return;
          }
          setPendingDelete(null);
        } finally {
          setDeleteBusy(false);
        }
      })();
    },
    [deletePersonality, memoryTransfer, pendingDelete],
  );

  const handleMemoryChoiceCancel = useCallback(() => {
    setPendingDelete(null);
    setDeleteError(null);
  }, []);

  // The shipped starter team is seeded automatically on a fresh host; this
  // button re-adds any builtin the user has since deleted (matched by stable id,
  // so kept/renamed ones are never duplicated). Missing count drives the label
  // and the disabled state.
  const missingDefaultsCount = useMemo(() => {
    const existingIds = new Set(personalities.map((entry) => entry.id));
    return DEFAULT_AGENT_PROFILES.filter((entry) => !existingIds.has(entry.id)).length;
  }, [personalities]);

  const handleRestoreDefaults = useCallback(async () => {
    const existingIds = new Set(personalities.map((entry) => entry.id));
    const missing = DEFAULT_AGENT_PROFILES.filter((entry) => !existingIds.has(entry.id));
    if (missing.length === 0) return;
    try {
      await savePersonalities([...personalities, ...missing]);
    } catch (error) {
      void alertDialog({
        title: "Unable to save",
        message: error instanceof Error ? error.message : String(error),
      });
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
                lessonCount={memoryCounts[personality.id] ?? 0}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No personalities yet. Add one to spawn agents by name with a fixed provider, model,
                effort, and prompt - or bring back the starter team.
              </Text>
              <Button
                variant="secondary"
                onPress={handleRestoreDefaults}
                disabled={restoreDisabled}
                style={styles.restoreButton}
                testID="agent-personalities-restore-button"
              >
                {`Add starter team (${DEFAULT_AGENT_PROFILES.length})`}
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
          takenNames={takenNames}
          speechOptions={speechOptions}
          lessonCount={editing.id ? (memoryCounts[editing.id] ?? 0) : 0}
          onClose={handleClose}
          onSave={handleSave}
          onPersistGeneratedCues={persistGeneratedCues}
        />
      ) : null}

      {pendingDelete ? (
        <PersonalityMemoryTransferSheet
          visible
          personality={pendingDelete.personality}
          lessonCount={pendingDelete.lessonCount}
          candidates={personalities}
          busy={deleteBusy}
          error={deleteError}
          onCancel={handleMemoryChoiceCancel}
          onConfirm={handleMemoryChoice}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface PersonalityRowProps {
  personality: AgentProfile;
  entries: readonly ProviderSnapshotEntry[];
  isFirst: boolean;
  usageCount: number;
  /** Accrued lessons. Shown so a delete never feels inconsequential. */
  lessonCount: number;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatUsageCount(count: number): string {
  if (count <= 0) {
    return "Never used";
  }
  return count === 1 ? "Used once" : `Used ${count} times`;
}

/**
 * Accrual, not management: the row states that this personality has learned
 * things, and stops there. Editing them lives in Context Management, so this
 * needs no affordance - just enough that you would not delete it casually.
 * Silent at zero, because "0 lessons" on every row is noise.
 */
function formatLessonCount(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? "1 lesson" : `${count} lessons`;
}

// Resolve the display labels the dropdowns use (not raw ids) plus availability.
// Falls back to the stored id when the provider/model is no longer resolvable.
function derivePersonalityRowInfo(
  personality: AgentProfile,
  entries: readonly ProviderSnapshotEntry[],
) {
  const entry = entries.find((candidate) => candidate.provider === personality.provider);
  const availability = checkPersonalityAvailability(personality, {
    providerStatus: entry?.status,
    providerEnabled: entry?.enabled,
    modelIds: entry?.models?.map((model) => model.id),
    modeIds: entry?.modes?.map((mode) => mode.id),
  });
  const providerLabel = entry?.label ?? personality.provider;
  const modelLabel =
    entry?.models?.find((model) => model.id === personality.model)?.label ?? personality.model;
  const roles = normalizePersonalityRoles(personality.roles);
  return { availability, providerLabel, modelLabel, roles };
}

// Role pills - one chip per role, matching the Agent Teams list. Optional
// right-alignment for the mobile row's top line (name | roles).
function RolePills({
  roles,
  align = "start",
}: {
  roles: readonly PersonalityRole[];
  align?: "start" | "end";
}): ReactElement | null {
  if (roles.length === 0) {
    return null;
  }
  return (
    <View style={align === "end" ? styles.rolePillsEnd : styles.rolePills}>
      {roles.map((role) => (
        <View key={role} style={styles.rolePill}>
          <Text style={styles.rolePillText}>{ROLE_LABELS[role]}</Text>
        </View>
      ))}
    </View>
  );
}

function PersonalityRow({
  personality,
  entries,
  isFirst,
  usageCount,
  lessonCount,
  onEdit,
  onRemove,
}: PersonalityRowProps): ReactElement {
  const handleEdit = useCallback(() => onEdit(personality.id), [onEdit, personality.id]);
  const handleRemove = useCallback(() => onRemove(personality.id), [onRemove, personality.id]);

  const { availability, providerLabel, modelLabel, roles } = derivePersonalityRowInfo(
    personality,
    entries,
  );
  const available = availability.available;

  // On the narrowest widths (xs) the row uses a two-column stacked layout per the
  // design: [icon] name | roles / provider·model | times / [buttons]. At sm+ it
  // keeps the inline icon | name+meta | actions layout.
  const isStacked = useIsExtraCompactFormFactor();

  const contentStyle = useMemo(
    () => [settingsStyles.rowContent, styles.infoColumn, !available && styles.dimmed],
    [available],
  );
  const stackedRowStyle = useMemo(
    () => [styles.stackedRow, !isFirst && styles.rowBorder],
    [isFirst],
  );
  const stackedTextBlockStyle = useMemo(
    () => [styles.stackedTextBlock, !available && styles.dimmed],
    [available],
  );
  const wideRowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && styles.rowBorder, styles.wideRow],
    [isFirst],
  );

  // A picked identity icon wins the leading slot; without one the provider
  // glyph tinted by the spinner glows keeps identifying the row.
  const icon = personality.icon ? (
    <AgentProfileGlyph icon={personality.icon} color={personality.color ?? ""} size="mdPlus" />
  ) : (
    <PersonalityProviderIcon
      provider={personality.provider}
      size="mdPlus"
      glowA={personality.spinner?.glowA}
      glowB={personality.spinner?.glowB}
    />
  );

  const actions = (
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
  );

  if (isStacked) {
    return (
      <View style={stackedRowStyle} testID={`agent-personality-row-${personality.id}`}>
        <View style={styles.stackedTop}>
          {icon}
          <View style={stackedTextBlockStyle}>
            <View style={styles.stackedLine}>
              <Text style={STACKED_NAME_TITLE_STYLE} numberOfLines={1}>
                {personality.name}
              </Text>
              <RolePills roles={roles} align="end" />
            </View>
            <View style={styles.stackedLine}>
              <Text style={STACKED_META_NAME_STYLE} numberOfLines={1}>
                {providerLabel} · {modelLabel}
              </Text>
              <Text style={styles.stackedMeta}>
                {[formatUsageCount(usageCount), formatLessonCount(lessonCount)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>
        </View>
        {!available ? (
          <Text style={styles.stackedUnavailable}>Unavailable - {availability.reason}</Text>
        ) : null}
        <View style={styles.stackedActions}>{actions}</View>
      </View>
    );
  }

  return (
    <View style={wideRowStyle} testID={`agent-personality-row-${personality.id}`}>
      {icon}
      <View style={contentStyle}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={META_LINE_STYLE} numberOfLines={1}>
          {[providerLabel, modelLabel, formatUsageCount(usageCount), formatLessonCount(lessonCount)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <RolePills roles={roles} />
        {!available ? (
          <Text style={styles.unavailableText} numberOfLines={2}>
            Unavailable - {availability.reason}
          </Text>
        ) : null}
      </View>
      {actions}
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
  // Lowercased trimmed names of every other personality in the roster; the
  // draft name must not collide with any of them.
  takenNames: readonly string[];
  speechOptions: SpeechSettingsOptions | null;
  /** Lessons this personality has already accrued (0 for a new one). */
  lessonCount: number;
  onClose: () => void;
  // Resolves with the saved personality (or undefined if the save failed) so the
  // editor can start background cue generation keyed to its id.
  onSave: (draft: PersonalityDraft) => Promise<AgentProfile | undefined>;
  // Persists cues generated in the background after a cue-less save completes.
  onPersistGeneratedCues: (
    personalityId: string,
    generated: Partial<Record<CueMoment, string[]>>,
  ) => Promise<void>;
}

function PersonalityEditModal({
  title,
  serverId,
  initialDraft,
  entries,
  takenNames,
  speechOptions,
  lessonCount,
  onClose,
  onSave,
  onPersistGeneratedCues,
}: PersonalityEditModalProps): ReactElement {
  const memorySupported = usePersonalityMemoryEnabled(serverId);
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  // This voice speaks cues, so the preview is heard at the cue channel's level
  // - not the spoken-reply volume, which is a different slider entirely.
  const { settings: appSettings } = useAppSettings();
  const canGenerateCues = useVisualizerVoiceCuesFeature(serverId);
  const canGenerateProfile = usePersonalityProfileFeature(serverId);
  const client = useHostRuntimeClient(serverId);
  const [activeTab, setActiveTab] = useState<EditorTab>("identity");
  const [isGeneratingCues, setIsGeneratingCues] = useState(false);
  // Human-readable failure notice for the last generation attempt (partial or
  // total), cleared when a new generation starts. Any result that lands after
  // the editor closes is dropped on the floor (the draft never saved), which is
  // exactly the intended behavior.
  const [cueGenError, setCueGenError] = useState<string | null>(null);
  // Same pair for the personality-profile writer on the Personality tab.
  const [isGeneratingProfile, setIsGeneratingProfile] = useState(false);
  const [profileGenError, setProfileGenError] = useState<string | null>(null);
  // Scope the editor's AI generation (cues + personality profile) to the user's
  // active (last selected) workspace on this host. Without a cwd the daemon
  // falls back to an arbitrary agent's cwd. Null when the last selection is
  // another host's.
  const lastWorkspace = useLastWorkspaceSelection();
  const generationCwd = useWorkspaceDirectory(
    lastWorkspace?.serverId === serverId ? serverId : null,
    lastWorkspace?.serverId === serverId ? lastWorkspace.workspaceId : null,
  );
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Normalize the seed so an existing personality whose stored mode can't run on
  // its model (Claude "auto" on Haiku) opens already coerced (→ "dontAsk") rather
  // than showing a phantom "auto" the picker no longer offers. The dirty check
  // below compares against this seed so an untouched open isn't treated as edited.
  const seedDraft = useMemo<PersonalityDraft>(() => {
    const entry = entries.find((candidate) => candidate.provider === initialDraft.provider);
    const modeId = coerceModeForModel(
      initialDraft.modeId,
      findModelDefinition(entry?.models, initialDraft.model),
    );
    return modeId === initialDraft.modeId ? initialDraft : { ...initialDraft, modeId };
  }, [entries, initialDraft]);
  const [draft, setDraft] = useState<PersonalityDraft>(seedDraft);
  const [isSaving, setIsSaving] = useState(false);

  const providerEntry = entries.find((entry) => entry.provider === draft.provider);
  // Auto support is per-model (daemon-stamped supportsAutoMode:false, e.g. Claude
  // Auto on Haiku); the mode list is per-provider, so intersect the two.
  const selectedModel = useMemo(
    () => findModelDefinition(providerEntry?.models, draft.model),
    [providerEntry, draft.model],
  );

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
      ...filterModesForModel(providerEntry?.modes ?? [], selectedModel)
        // Drop system-assigned modes (Claude "dontAsk") - never a user pick.
        .filter((mode) => isUserSelectableMode(draft.provider, mode.id))
        .map((mode) => ({
          id: mode.id,
          label: mode.label ?? mode.id,
        })),
    ],
    [providerEntry, selectedModel, draft.provider],
  );
  // A stored mode can be one the dropdown hides (a coerced "dontAsk"); resolve its
  // real label from the full provider mode set so the trigger shows it read-only
  // rather than the raw id.
  const modeDisplayLabel = useMemo(() => {
    if (!draft.modeId) return undefined;
    return providerEntry?.modes?.find((mode) => mode.id === draft.modeId)?.label;
  }, [providerEntry, draft.modeId]);
  // The bound model's OWN thinking options, which is what the composer shows -
  // so both surfaces offer one vocabulary instead of two. It matters beyond
  // consistency: a provider may advertise an option that is deliberately off the
  // canonical ladder (Claude's "Ultra Code"), and the canonical rungs cannot
  // name it. Offering the model's list is what makes such an option pickable
  // here at all. It stays opt-in: resolveEffortOption never MAPS a canonical
  // rung onto an unparseable option, so nothing selects Ultra Code on a user's
  // behalf - it has to be chosen deliberately.
  //
  // Falls back to the canonical ladder only when the model advertises nothing,
  // so a template can still carry an intent for a model whose options the host
  // has not loaded yet.
  const effortOptions = useMemo<ComboboxOption[]>(() => {
    const advertised = selectedModel?.thinkingOptions ?? [];
    const options =
      advertised.length > 0
        ? advertised.map((option) => ({ id: option.id, label: option.label ?? option.id }))
        : EFFORT_LEVELS.map((level) => ({ id: level, label: formatEffortLabel(level) }));
    return [{ id: "", label: "None" }, ...options];
  }, [selectedModel]);
  const voiceOptions = useMemo(() => buildVoiceOptions(speechOptions), [speechOptions]);
  // Only offer a voice when the host actually exposes TTS voices beyond "None".
  const showVoice = voiceOptions.length > 1;
  const cuePreviewGain = appSettings.agentVoiceCuesVolume / 100;
  const voicePreview = useMemo(
    () =>
      canPreviewVoice ? (
        <VoicePreviewButton
          serverId={serverId}
          text={buildPersonalityIntro(draft.name, draft.roles)}
          voiceName={draft.voice?.name}
          voiceModel={draft.voice?.model}
          voiceProvider={draft.voice?.provider}
          gain={cuePreviewGain}
          testID="agent-personality-voice-preview"
        />
      ) : undefined,
    [canPreviewVoice, cuePreviewGain, serverId, draft.name, draft.roles, draft.voice],
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
  const setModel = useCallback(
    (value: string) => {
      // A stored "auto" can become unrunnable on the newly-picked model (Claude
      // Auto on Haiku); coerce it so a broken mode is never saved.
      setDraft((current) => ({
        ...current,
        model: value,
        modeId: coerceModeForModel(
          current.modeId,
          findModelDefinition(providerEntry?.models, value),
        ),
      }));
    },
    [providerEntry],
  );
  const setMode = useCallback((value: string) => {
    setDraft((current) => ({ ...current, modeId: value }));
  }, []);
  const setEffort = useCallback((value: string) => {
    setDraft((current) => ({ ...current, effort: value }));
  }, []);
  const setPrompt = useCallback((value: string) => {
    setDraft((current) => ({ ...current, personalityPrompt: value }));
  }, []);
  const setNotes = useCallback((value: string) => {
    setDraft((current) => ({ ...current, notes: value }));
  }, []);
  const setRespectAppend = useCallback((value: boolean) => {
    setDraft((current) => ({ ...current, respectGlobalAppendPrompt: value }));
  }, []);
  const setMemoryEnabled = useCallback((value: boolean) => {
    setDraft((current) => ({ ...current, memoryEnabled: value }));
  }, []);
  const setAppearance = useCallback((next: { icon: string; color: string }) => {
    setDraft((current) => ({ ...current, icon: next.icon, color: next.color }));
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

  const setCueLine = useCallback((kind: CueMoment, id: string, value: string) => {
    setDraft((current) => ({
      ...current,
      voiceCues: {
        ...current.voiceCues,
        [kind]: current.voiceCues[kind].map((line) =>
          line.id === id ? { ...line, text: value } : line,
        ),
      },
    }));
  }, []);
  const addCueLine = useCallback((kind: CueMoment) => {
    setDraft((current) => ({
      ...current,
      voiceCues: { ...current.voiceCues, [kind]: [...current.voiceCues[kind], newCueLine("")] },
    }));
  }, []);
  const removeCueLine = useCallback((kind: CueMoment, id: string) => {
    setDraft((current) => ({
      ...current,
      voiceCues: {
        ...current.voiceCues,
        [kind]: current.voiceCues[kind].filter((line) => line.id !== id),
      },
    }));
  }, []);

  // Author cue lines for the current draft (name + prompt + roles) via the
  // Writer chain. ONE request authors all four moments: the daemon prompt gives
  // the model the whole character plus every moment at once, which is what makes
  // the four groups sound like the same person and stay distinct from each other
  // (fanning out one request per moment meant four separate readings of the
  // persona, and four cold starts). Returns the lines per SUCCEEDED moment plus
  // the moments that came back empty, so callers can merge without wiping
  // hand-written lines and can tell the user what is missing.
  const generateCuesFor = useCallback(
    async (
      source: PersonalityDraft,
    ): Promise<{
      generated: Partial<Record<CueMoment, string[]>>;
      failedMoments: CueMoment[];
    }> => {
      if (!client) return { generated: {}, failedMoments: [...CUE_MOMENTS] };
      const name = source.name.trim() || "Agent";
      const prompt = source.personalityPrompt.trim();
      const roles = source.roles;
      const generated: Partial<Record<CueMoment, string[]>> = {};
      const failedMoments: CueMoment[] = [];
      let cues: Awaited<ReturnType<typeof client.generateVisualizerVoiceCues>>["cues"];
      try {
        const result = await client.generateVisualizerVoiceCues({
          name,
          ...(prompt ? { prompt } : {}),
          ...(generationCwd ? { cwd: generationCwd } : {}),
          ...(roles.length > 0 ? { roles } : {}),
        });
        cues = result.cues;
      } catch {
        return { generated, failedMoments: [...CUE_MOMENTS] };
      }
      for (const moment of CUE_MOMENTS) {
        const lines = cues?.[moment] ?? [];
        if (lines.length > 0) {
          generated[moment] = lines;
        } else {
          failedMoments.push(moment);
        }
      }
      return { generated, failedMoments };
    },
    [client, generationCwd],
  );

  // The generation ritual both callers (the Generate button and the save-time
  // auto-fill) share: the mounted guard plus surfacing partial/total failure.
  // Resolves with the per-moment lines that succeeded.
  const runCueGeneration = useCallback(
    async (source: PersonalityDraft): Promise<Partial<Record<CueMoment, string[]>>> => {
      setCueGenError(null);
      const { generated, failedMoments } = await generateCuesFor(source);
      if (isMountedRef.current && failedMoments.length > 0) {
        setCueGenError(
          failedMoments.length === CUE_MOMENTS.length
            ? "Voice cue generation failed. Any existing lines were kept."
            : `Couldn't generate ${failedMoments
                .map((moment) => CUE_KIND_LABELS[moment])
                .join(", ")} lines. Existing lines for those moments were kept.`,
        );
      }
      return generated;
    },
    [generateCuesFor],
  );

  const handleGenerateCues = useCallback(() => {
    if (!client || isGeneratingCues) return;
    setIsGeneratingCues(true);
    void (async () => {
      try {
        const generated = await runCueGeneration(draft);
        // Merge per moment - only moments that succeeded overwrite; a failed
        // moment keeps the draft's existing (possibly hand-written) lines.
        // Drop late results if the editor already closed (draft is gone).
        if (isMountedRef.current && Object.keys(generated).length > 0) {
          setDraft((current) => ({
            ...current,
            voiceCues: mergeGeneratedCues(current.voiceCues, generated),
          }));
        }
      } catch {
        // Best-effort - leave the fields as-is.
      } finally {
        if (isMountedRef.current) {
          setIsGeneratingCues(false);
        }
      }
    })();
  }, [client, isGeneratingCues, runCueGeneration, draft]);

  // Author the personality prompt from what the editor knows: the handle, the
  // roles it will be spawned for, and the spinner colors. Overwriting text the
  // user wrote is the one destructive thing here, so a non-empty field asks
  // first: a generated profile is never worth losing something hand-written.
  const handleGenerateProfile = useCallback(() => {
    if (!client || isGeneratingProfile) return;
    void (async () => {
      if (draft.personalityPrompt.trim().length > 0) {
        const confirmed = await confirmDialog({
          title: "Replace this personality?",
          message: "The generated profile will overwrite what's written here.",
          confirmLabel: "Replace",
          cancelLabel: "Keep mine",
          destructive: true,
        });
        if (!confirmed) return;
      }
      if (!isMountedRef.current) return;
      setIsGeneratingProfile(true);
      setProfileGenError(null);
      try {
        const result = await client.generatePersonalityProfile({
          name: draft.name.trim() || "Agent",
          ...(draft.roles.length > 0 ? { roles: draft.roles } : {}),
          ...(isHexColor(draft.glowA) ? { glowA: draft.glowA.trim() } : {}),
          ...(isHexColor(draft.glowB) ? { glowB: draft.glowB.trim() } : {}),
          ...(generationCwd ? { cwd: generationCwd } : {}),
        });
        if (!isMountedRef.current) return;
        const profile = result.profile?.trim();
        if (profile) {
          setDraft((current) => ({ ...current, personalityPrompt: profile }));
        } else {
          setProfileGenError(result.error ?? "Personality generation failed. Nothing was changed.");
        }
      } catch (error) {
        if (isMountedRef.current) {
          setProfileGenError(
            error instanceof Error ? error.message : "Personality generation failed.",
          );
        }
      } finally {
        if (isMountedRef.current) {
          setIsGeneratingProfile(false);
        }
      }
    })();
  }, [client, isGeneratingProfile, draft, generationCwd]);

  const nameCollides = takenNames.includes(draft.name.trim().toLowerCase());
  const glowsValid = isHexColor(draft.glowA) && isHexColor(draft.glowB);
  const canSave =
    draft.name.trim().length > 0 &&
    !nameCollides &&
    Boolean(draft.provider) &&
    Boolean(draft.model) &&
    glowsValid;

  const handleSave = useCallback(() => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    // The parent unmounts this modal on success and surfaces save errors itself
    // (Alert in its handleSave); the lock holds until the round-trip settles so
    // a double-click cannot mint a duplicate personality.
    void (async () => {
      try {
        // Save the draft as-is - the save NEVER blocks on cue generation (that
        // used to hang the editor; see the earlier bounded-timeout fix). onSave
        // closes the editor and returns the saved personality.
        const saved = await onSave(draft);
        // Best-effort courtesy: when the user never filled cues, generate them in
        // the BACKGROUND and persist onto the saved personality when they land.
        // This runs detached (the editor is already closing), touches no modal
        // state, and quietly does nothing on failure - a cue-less personality is
        // valid (it simply stays silent).
        if (saved && canGenerateCues && client && draftVoiceCuesAreEmpty(draft.voiceCues)) {
          void (async () => {
            try {
              const { generated } = await generateCuesFor(draft);
              if (Object.keys(generated).length > 0) {
                await onPersistGeneratedCues(saved.id, generated);
              }
            } catch {
              // best-effort - leave the personality without cues
            }
          })();
        }
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    })();
  }, [
    canSave,
    draft,
    isSaving,
    onSave,
    canGenerateCues,
    client,
    generateCuesFor,
    onPersistGeneratedCues,
  ]);

  // Cancel/backdrop-close confirms before discarding a dirty draft. The draft
  // is plain JSON-safe data seeded from initialDraft, so a stringify comparison
  // is an exact dirty check.
  const handleClose = useCallback(() => {
    if (JSON.stringify(draft) === JSON.stringify(seedDraft)) {
      onClose();
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Discard changes?",
        message: "This personality has unsaved changes.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (confirmed) onClose();
    })();
  }, [draft, seedDraft, onClose]);

  const footer = useMemo(
    () => (
      <View style={styles.editorActions}>
        <Button variant="secondary" size="sm" style={FLEX_1} onPress={handleClose}>
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
    ),
    [handleClose, handleSave, canSave, isSaving],
  );

  return (
    <TabbedModalSheet
      header={header}
      visible
      onClose={handleClose}
      tabs={EDITOR_TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      footer={footer}
      webScrollbar
      tabsTestID="agent-personality-tabs"
      testID="agent-personality-edit-modal"
    >
      <>
        {activeTab === "identity" ? (
          <>
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
              One word - letters, numbers, - or _ - up to {MAX_PERSONALITY_NAME_LENGTH} characters.
            </Text>
            {nameCollides ? (
              <Text style={styles.fieldError} testID="agent-personality-name-collision">
                Another personality already uses this name.
              </Text>
            ) : null}

            <RolesField roles={draft.roles} onToggle={toggleRole} onSetAll={setAllRoles} />

            <SpinnerField
              glowA={draft.glowA}
              glowB={draft.glowB}
              onGlowAChange={setGlowA}
              onGlowBChange={setGlowB}
            />

            <AgentProfileAppearanceField
              label="Appearance"
              icon={draft.icon}
              color={draft.color}
              onChange={setAppearance}
              testID="agent-personality-appearance"
            />
          </>
        ) : null}

        {activeTab === "personality" ? (
          <>
            <FieldLabel label="Personality prompt" />
            <TextArea
              value={draft.personalityPrompt}
              onChangeText={setPrompt}
              placeholder="How this personality should behave (fun, optional)."
              placeholderTextColor={styles.placeholder.color}
              style={styles.textArea}
              testID="agent-personality-prompt-input"
            />
            <ProfileGeneratorField
              canGenerate={canAuthorWithAi(canGenerateProfile, client)}
              hasName={draft.name.trim().length > 0}
              isGenerating={isGeneratingProfile}
              error={profileGenError}
              onGenerate={handleGenerateProfile}
            />

            <FieldLabel label="Notes" />
            <TextArea
              value={draft.notes}
              onChangeText={setNotes}
              placeholder="When to pick this one. Shown to agents choosing a collaborator, not to the model itself."
              placeholderTextColor={styles.placeholder.color}
              style={styles.textArea}
              testID="agent-personality-notes-input"
            />

            <View style={styles.toggleRow}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Respect global append prompt</Text>
                <Text style={settingsStyles.rowHint}>
                  When off, the personality prompt stands alone (no host-wide append stacked on
                  top).
                </Text>
              </View>
              <Switch value={draft.respectGlobalAppendPrompt} onValueChange={setRespectAppend} />
            </View>

            {/* Accrual, not management. This says the personality HAS learned
                things - enough that you would not delete it casually - and points
                at the one surface that owns everything sent before you type.
                Full CRUD here would need list and diff tooling this dialog does
                not have, and would split memory across two places. */}
            {memorySupported ? (
              <View style={styles.toggleRow}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Remember lessons</Text>
                  <Text style={settingsStyles.rowHint}>
                    {lessonCount > 0
                      ? `${lessonCount === 1 ? "1 lesson" : `${lessonCount} lessons`} remembered so far. ` +
                        "Read and edit them in Context Management."
                      : "This personality records what it learns and carries it into later sessions. " +
                        "Read and edit its lessons in Context Management."}
                  </Text>
                </View>
                <Switch value={draft.memoryEnabled} onValueChange={setMemoryEnabled} />
              </View>
            ) : null}
          </>
        ) : null}

        {activeTab === "model" ? (
          <>
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
              displayLabel={modeDisplayLabel}
              testID="agent-personality-mode-picker"
            />
            <PickerRow
              label="Effort"
              value={draft.effort}
              options={effortOptions}
              onChange={setEffort}
              testID="agent-personality-effort-picker"
            />
          </>
        ) : null}

        {activeTab === "voice" ? (
          <>
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
            <VoiceCuesEditor
              cues={draft.voiceCues}
              canGenerate={canAuthorWithAi(canGenerateCues, client)}
              isGenerating={isGeneratingCues}
              error={cueGenError}
              onGenerate={handleGenerateCues}
              onSetLine={setCueLine}
              onAddLine={addCueLine}
              onRemoveLine={removeCueLine}
            />
          </>
        ) : null}
      </>
    </TabbedModalSheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-fields
// ---------------------------------------------------------------------------

function FieldLabel({ label }: { label: string }): ReactElement {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

// ---------------------------------------------------------------------------
// Personality writer. Authors the prompt prose above it from the draft's name,
// roles and spinner colors. Hidden entirely on a host without the capability,
// where the field stays hand-written (how every personality used to be made).
// ---------------------------------------------------------------------------

interface ProfileGeneratorFieldProps {
  canGenerate: boolean;
  // The name is the character's seed, so there is nothing to write without one.
  hasName: boolean;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
}

function ProfileGeneratorField({
  canGenerate,
  hasName,
  isGenerating,
  error,
  onGenerate,
}: ProfileGeneratorFieldProps): ReactElement | null {
  if (!canGenerate) {
    return null;
  }
  return (
    <>
      <Text style={styles.fieldHint}>
        Written from the name, the roles, and the spinner colors. Traits are chosen to make this
        agent better at the roles you gave it, and to work well with the rest of the team. Edit
        anything you like afterwards.
      </Text>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={Robot}
        onPress={onGenerate}
        disabled={isGenerating || !hasName}
        testID="agent-personality-generate-profile"
      >
        {isGenerating ? "Writing personality…" : "Generate with AI"}
      </Button>
      {error ? (
        <Text style={styles.fieldError} testID="agent-personality-profile-gen-error">
          {error}
        </Text>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Voice cues editor - one group per CUE_MOMENTS moment (join / thinking /
// waiting / done), each an
// editable list of short spoken lines, with an "Generate with AI" action that
// authors a set from the draft's name + prompt.
// ---------------------------------------------------------------------------

interface CueLineRowProps {
  kind: CueMoment;
  line: CueLineDraft;
  index: number;
  onSetLine: (kind: CueMoment, id: string, value: string) => void;
  onRemoveLine: (kind: CueMoment, id: string) => void;
}

function CueLineRow({ kind, line, index, onSetLine, onRemoveLine }: CueLineRowProps): ReactElement {
  const handleChange = useCallback(
    (value: string) => onSetLine(kind, line.id, value),
    [kind, line.id, onSetLine],
  );
  const handleRemove = useCallback(
    () => onRemoveLine(kind, line.id),
    [kind, line.id, onRemoveLine],
  );
  return (
    <View style={styles.cueRow}>
      <TextInput
        value={line.text}
        onChangeText={handleChange}
        placeholder="e.g. On it"
        placeholderTextColor={styles.placeholder.color}
        style={styles.cueInput}
        testID={`agent-personality-cue-${kind}-${index}`}
      />
      <IconButton Icon={ThemedTrash} label="Remove line" onPress={handleRemove} destructive />
    </View>
  );
}

interface CueGroupEditorProps {
  kind: CueMoment;
  lines: CueLineDraft[];
  onSetLine: (kind: CueMoment, id: string, value: string) => void;
  onAddLine: (kind: CueMoment) => void;
  onRemoveLine: (kind: CueMoment, id: string) => void;
}

function CueGroupEditor({
  kind,
  lines,
  onSetLine,
  onAddLine,
  onRemoveLine,
}: CueGroupEditorProps): ReactElement {
  const handleAdd = useCallback(() => onAddLine(kind), [kind, onAddLine]);
  return (
    <View style={styles.cueGroup}>
      <FieldLabel label={CUE_KIND_LABELS[kind]} />
      <Text style={styles.fieldHint}>{CUE_KIND_HINTS[kind]}</Text>
      {lines.map((line, index) => (
        <CueLineRow
          key={line.id}
          kind={kind}
          line={line}
          index={index}
          onSetLine={onSetLine}
          onRemoveLine={onRemoveLine}
        />
      ))}
      <Button variant="ghost" size="sm" onPress={handleAdd}>
        Add line
      </Button>
    </View>
  );
}

interface VoiceCuesEditorProps {
  cues: DraftVoiceCues;
  canGenerate: boolean;
  isGenerating: boolean;
  // Failure notice for the last generation attempt (partial or total).
  error: string | null;
  onGenerate: () => void;
  onSetLine: (kind: CueMoment, id: string, value: string) => void;
  onAddLine: (kind: CueMoment) => void;
  onRemoveLine: (kind: CueMoment, id: string) => void;
}

function VoiceCuesEditor({
  cues,
  canGenerate,
  isGenerating,
  error,
  onGenerate,
  onSetLine,
  onAddLine,
  onRemoveLine,
}: VoiceCuesEditorProps): ReactElement {
  return (
    <View style={styles.cuesContainer}>
      <Text style={styles.fieldHint}>
        Short lines spoken in this personality&apos;s voice when its node joins the graph, first
        starts thinking, waits on its sub-agents, and finishes (Settings → Visualizer → Sound →
        Voice cues). Left empty, a set is generated for you on save.
      </Text>
      {canGenerate ? (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={Robot}
          onPress={onGenerate}
          disabled={isGenerating}
          testID="agent-personality-generate-cues"
        >
          {isGenerating ? "Writing all four moments…" : "Generate with AI"}
        </Button>
      ) : null}
      {error ? (
        <Text style={styles.fieldError} testID="agent-personality-cue-gen-error">
          {error}
        </Text>
      ) : null}
      {CUE_MOMENTS.map((kind) => (
        <CueGroupEditor
          key={kind}
          kind={kind}
          lines={cues[kind]}
          onSetLine={onSetLine}
          onAddLine={onAddLine}
          onRemoveLine={onRemoveLine}
        />
      ))}
    </View>
  );
}

interface PickerRowProps {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (next: string) => void;
  testID: string;
  // Optional control rendered just left of the dropdown (e.g. a preview button).
  trailing?: ReactNode;
  // Overrides the trigger label - used when the current value is intentionally
  // absent from `options` (a hidden mode) but must still display its real name.
  displayLabel?: string;
}

function PickerRow({
  label,
  value,
  options,
  onChange,
  testID,
  trailing,
  displayLabel,
}: PickerRowProps): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.id === value);
  const triggerLabel = displayLabel ?? selected?.label ?? value;

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
      accessibilityLabel={`${ROLE_LABELS[role]} - ${ROLE_HINTS[role]}`}
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
        <BlobLoader size="lg" glowA={glowA} glowB={glowB} />
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
  const valid = isHexColor(value);
  // An invalid color never reaches the swatch style; it shows as the empty
  // swatch with the input in error styling until the text parses again.
  const swatchStyle = useMemo(
    () => [styles.swatch, valid && { backgroundColor: value }],
    [valid, value],
  );
  const inputStyle = useMemo(
    () => [styles.colorTextInput, !valid && styles.colorTextInputInvalid],
    [valid],
  );
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
          style={inputStyle}
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
  // Inline (sm+) row: gap between the leading icon, the label block, and the
  // trailing action buttons.
  wideRow: {
    gap: theme.spacing[3],
  },
  // Stacked (xs) row: a two-column grid - [icon] name|roles over
  // provider·model|times - with the action buttons centered on their own line.
  stackedRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  stackedTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  stackedTextBlock: {
    flex: 1,
    gap: 6,
  },
  stackedLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  stackedName: {
    flexShrink: 1,
  },
  stackedMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs + 2,
  },
  stackedActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  stackedUnavailable: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs + 2,
  },
  rolePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // Info column for the wide row: a uniform 6px gap between the name, meta, and
  // role-pill rows (each of which centers its own contents vertically). The
  // per-child marginTops that used to space these rows are neutralized so the
  // column gap is the single source of spacing.
  infoColumn: {
    gap: 6,
  },
  metaLine: {
    marginTop: 0,
  },
  rolePillsEnd: {
    flexShrink: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  rolePill: {
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    // borderAccent, not border: this pill sits on a surface1 card, so its fill
    // is surface2 for contrast against that card - but `border` is nearly
    // identical to surface2 on this theme, which swallows the pill's own
    // outline. borderAccent is a real step brighter.
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  rolePillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
    marginTop: 0,
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
  cuesContainer: {
    gap: theme.spacing[3],
  },
  cueGroup: {
    gap: theme.spacing[2],
  },
  cueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  cueInput: {
    flex: 1,
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
  fieldError: {
    marginTop: -theme.spacing[1],
    color: theme.colors.destructive,
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
  colorTextInputInvalid: {
    borderColor: theme.colors.destructive,
  },
  editorActions: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
}));

// Static combined styles for the stacked mobile row - hoisted so the JSX passes
// stable array references (react-perf/jsx-no-new-array-as-prop).
const STACKED_NAME_TITLE_STYLE = [settingsStyles.rowTitle, styles.stackedName];
const STACKED_META_NAME_STYLE = [styles.stackedMeta, styles.stackedName];
const META_LINE_STYLE = [settingsStyles.rowHint, styles.metaLine];
