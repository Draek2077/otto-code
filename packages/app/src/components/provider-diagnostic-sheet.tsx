import * as Clipboard from "expo-clipboard";
import {
  AlertTriangle,
  Copy,
  FileText,
  Plus,
  RotateCw,
  Search,
  Trash2,
} from "@/components/icons/material-icons";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  View,
} from "react-native";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useToast } from "@/contexts/toast-context";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { useSessionStore } from "@/stores/session-store";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { formatTimeAgo } from "@/utils/time";
import { compareMatchScores, scoreTextFields } from "@/utils/score-match";
import type { AgentModelDefinition, AgentProvider } from "@otto-code/protocol/agent-types";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import type { ProviderProfileModel } from "@otto-code/protocol/provider-config";
import {
  COMPACTION_THRESHOLD_PERCENTS,
  OTTO_TOOL_GROUPS,
  type OttoToolGroup,
} from "@otto-code/protocol/provider-config";
import { Switch } from "@/components/ui/switch";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { TextFieldPicker, type ComboboxOption } from "@/components/ui/text-field-picker";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "./provider-diagnostic-models";

// Themed leaf per docs/unistyles.md "Static Theme Imports" — only the icon
// re-renders on theme changes, not the row that hosts it.
const ThemedRemoveIcon = withUnistyles(Trash2, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.destructive,
}));

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

type ProviderSettingsTab = "models" | "connection" | "tools" | "agents";

function buildProviderTabOptions(
  t: TFunction,
  hasConnectionTab: boolean,
  hasToolsTab: boolean,
  hasAgentsTab: boolean,
): SegmentedControlOption<ProviderSettingsTab>[] {
  const options: SegmentedControlOption<ProviderSettingsTab>[] = [];
  if (hasConnectionTab) {
    options.push({
      value: "connection",
      label: t("settings.providers.tabs.connection"),
      testID: "provider-settings-tab-connection",
    });
  }
  options.push({
    value: "models",
    label: t("settings.providers.tabs.models"),
    testID: "provider-settings-tab-models",
  });
  if (hasToolsTab) {
    options.push({
      value: "tools",
      label: t("settings.providers.tabs.tools"),
      testID: "provider-settings-tab-tools",
    });
  }
  if (hasAgentsTab) {
    options.push({
      value: "agents",
      label: t("settings.providers.tabs.agents"),
      testID: "provider-settings-tab-agents",
    });
  }
  return options;
}

// null = "no explicit choice yet": the dialog opens on the first tab.
function resolveCurrentTab(
  activeTab: ProviderSettingsTab | null,
  tabOptions: SegmentedControlOption<ProviderSettingsTab>[],
): ProviderSettingsTab {
  if (activeTab !== null && tabOptions.some((option) => option.value === activeTab)) {
    return activeTab;
  }
  return tabOptions[0]?.value ?? "models";
}

// Themed leaf per docs/unistyles.md "Static Theme Imports".
const ThemedSearchIcon = withUnistyles(Search, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

function ModelsSearchField({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={sheetStyles.searchField}>
      <ThemedSearchIcon />
      <AdaptiveTextInput
        // @ts-expect-error - outlineStyle is web-only
        style={MODELS_SEARCH_INPUT_STYLE}
        placeholder={t("settings.providers.models.searchPlaceholder")}
        initialValue={initialValue}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        testID="provider-settings-search"
      />
    </View>
  );
}

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function DiscoveredModelRow({ model }: { model: AgentModelDefinition }) {
  return (
    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text
        style={sheetStyles.monoHint}
        numberOfLines={1}
        selectable
        dataSet={CODE_SURFACE_DATASET}
      >
        {model.id}
      </Text>
      {model.description ? (
        <Text style={sheetStyles.descriptionInline} numberOfLines={1}>
          {model.description}
        </Text>
      ) : null}
    </View>
  );
}

function CustomModelRow({
  model,
  deleting,
  onDelete,
}: {
  model: ProviderProfileModel;
  deleting: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      deleting ? sheetStyles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text
        style={sheetStyles.monoHint}
        numberOfLines={1}
        selectable
        dataSet={CODE_SURFACE_DATASET}
      >
        {model.id}
      </Text>
      <View style={sheetStyles.modelRowFiller} />
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <ThemedRemoveIcon />
      </Pressable>
    </View>
  );
}

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <View style={sheetStyles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={sheetStyles.sectionHeaderMeta}>
        {count !== undefined ? (
          <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
        ) : null}
        {count !== undefined && hint ? (
          <Text style={settingsStyles.sectionHeaderTitle}>·</Text>
        ) : null}
        {hint ? <Text style={settingsStyles.sectionHeaderTitle}>{hint}</Text> : null}
      </View>
    </View>
  );
}

interface ProviderConnectionDescriptor {
  baseUrlKey: string;
  apiKeyKey: string;
  baseUrl: string;
  apiKey: string;
}

function readProviderConfigEntry(
  config: MutableDaemonConfig | null,
  provider: string,
): Record<string, unknown> | null {
  const entry = config?.providers?.[provider];
  return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
}

function readProviderExtends(entry: Record<string, unknown> | null): string | null {
  const value = entry?.["extends"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readProviderEnv(entry: Record<string, unknown> | null): Record<string, string> {
  const env = entry?.["env"];
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(env as Record<string, unknown>).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
}

function resolveProviderConnection(
  entry: Record<string, unknown> | null,
  extendsProvider: string | null,
): ProviderConnectionDescriptor | null {
  const env = readProviderEnv(entry);
  if (extendsProvider === "codex" || extendsProvider === "openai-compatible") {
    return {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      baseUrl: env["OPENAI_BASE_URL"] ?? "",
      apiKey: env["OPENAI_API_KEY"] ?? "",
    };
  }
  if (extendsProvider === "claude") {
    // Third-party Anthropic-compatible endpoints use AUTH_TOKEN; keep editing
    // API_KEY when that is what the entry already uses.
    const apiKeyKey =
      env["ANTHROPIC_AUTH_TOKEN"] === undefined && env["ANTHROPIC_API_KEY"] !== undefined
        ? "ANTHROPIC_API_KEY"
        : "ANTHROPIC_AUTH_TOKEN";
    return {
      baseUrlKey: "ANTHROPIC_BASE_URL",
      apiKeyKey,
      baseUrl: env["ANTHROPIC_BASE_URL"] ?? "",
      apiKey: env[apiKeyKey] ?? "",
    };
  }
  return null;
}

// Known base URLs for the two connection env-var families (see
// docs/custom-providers.md). Still fully freeform via allowCustomValue -
// these are suggestions, not a closed list.
const OPENAI_COMPATIBLE_BASE_URL_PRESETS: ComboboxOption[] = [
  { id: "http://localhost:1234/v1", label: "LM Studio (localhost:1234)" },
  { id: "http://localhost:11434/v1", label: "Ollama (localhost:11434)" },
];

const CLAUDE_COMPATIBLE_BASE_URL_PRESETS: ComboboxOption[] = [
  { id: "https://api.z.ai/api/anthropic", label: "Z.AI" },
  {
    id: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    label: "Alibaba/Qwen (coding plan)",
  },
  {
    id: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    label: "Alibaba/Qwen (pay-as-you-go)",
  },
];

function ProviderConnectionSection({
  provider,
  connection,
  patchConfig,
  refresh,
}: {
  provider: string;
  connection: ProviderConnectionDescriptor;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [apiKey, setApiKey] = useState(connection.apiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = baseUrl.trim() !== connection.baseUrl || apiKey.trim() !== connection.apiKey;
  const canSave = isDirty && baseUrl.trim().length > 0 && !saving;
  const baseUrlPresets =
    connection.baseUrlKey === "OPENAI_BASE_URL"
      ? OPENAI_COMPATIBLE_BASE_URL_PRESETS
      : CLAUDE_COMPATIBLE_BASE_URL_PRESETS;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    void patchConfig({
      providers: {
        [provider]: {
          env: {
            [connection.baseUrlKey]: baseUrl.trim(),
            [connection.apiKeyKey]: apiKey.trim(),
          },
        },
      },
    })
      .then(() => refresh([provider]))
      .then(() => toast.show(t("settings.providers.connection.saved"), { variant: "success" }))
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : t("settings.providers.connection.saveFailed"),
        );
      })
      .finally(() => setSaving(false));
  }, [apiKey, baseUrl, canSave, connection, patchConfig, provider, refresh, t, toast]);

  return (
    <View style={sheetStyles.section}>
      <View style={sheetStyles.connectionCard}>
        <View style={sheetStyles.formGroup}>
          <Text style={sheetStyles.formLabel}>{t("settings.providers.connection.baseUrl")}</Text>
          <TextFieldPicker
            value={baseUrl}
            onChange={setBaseUrl}
            options={baseUrlPresets}
            placeholder="http://localhost:1234/v1"
            testID="provider-connection-base-url"
          />
          <Text style={sheetStyles.formLabel}>{t("settings.providers.connection.apiKey")}</Text>
          <AdaptiveTextInput
            initialValue={apiKey}
            resetKey={`connection-key-${provider}`}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="provider-connection-api-key"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
          {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
          <View style={sheetStyles.formActions}>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!canSave}
              loading={saving}
              testID="provider-connection-save"
            >
              {saving
                ? t("settings.providers.connection.saving")
                : t("settings.providers.connection.save")}
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

function toolGroupLabel(t: TFunction, group: OttoToolGroup): string {
  switch (group) {
    case "preview":
      return t("settings.providers.tools.groups.preview");
    case "browser":
      return t("settings.providers.tools.groups.browser");
    case "web":
      return t("settings.providers.tools.groups.web");
    case "agents":
      return t("settings.providers.tools.groups.agents");
    case "terminals":
      return t("settings.providers.tools.groups.terminals");
    case "schedules":
      return t("settings.providers.tools.groups.schedules");
    case "workspace":
      return t("settings.providers.tools.groups.workspace");
  }
}

function ToolGroupToggleRow({
  group,
  label,
  enabled,
  disabled,
  onToggle,
}: {
  group: OttoToolGroup;
  label: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (group: OttoToolGroup, next: boolean) => void;
}) {
  const handleChange = useCallback((next: boolean) => onToggle(group, next), [group, onToggle]);
  return (
    <View style={sheetStyles.toolGroupRow}>
      <Text style={sheetStyles.toolGroupLabel}>{label}</Text>
      <Switch
        value={enabled}
        onValueChange={handleChange}
        disabled={disabled}
        testID={`provider-tool-group-${group}`}
      />
    </View>
  );
}

/**
 * Per-provider selection of which Otto tool groups are injected into the model
 * (natively-injected providers like openai-compatible). Absent config = all
 * groups. Each toggle writes the full enabled list back to config.json.
 */
function ProviderToolGroupsSection({
  provider,
  selectedGroups,
  patchConfig,
  refresh,
}: {
  provider: string;
  selectedGroups: readonly OttoToolGroup[] | null;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [savingGroup, setSavingGroup] = useState<OttoToolGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = useMemo(
    () => new Set<OttoToolGroup>(selectedGroups ?? OTTO_TOOL_GROUPS),
    [selectedGroups],
  );

  const handleToggle = useCallback(
    (group: OttoToolGroup, next: boolean) => {
      const nextSet = new Set(enabled);
      if (next) {
        nextSet.add(group);
      } else {
        nextSet.delete(group);
      }
      const nextGroups = OTTO_TOOL_GROUPS.filter((candidate) => nextSet.has(candidate));
      setSavingGroup(group);
      setError(null);
      void patchConfig({ providers: { [provider]: { ottoToolGroups: nextGroups } } })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.tools.saveFailed"));
        })
        .finally(() => setSavingGroup((current) => (current === group ? null : current)));
    },
    [enabled, patchConfig, provider, refresh, t],
  );

  return (
    <View style={sheetStyles.section}>
      <View style={sheetStyles.connectionCard}>
        <Text style={sheetStyles.formLabel}>{t("settings.providers.tools.description")}</Text>
        {OTTO_TOOL_GROUPS.map((group) => (
          <ToolGroupToggleRow
            key={group}
            group={group}
            label={toolGroupLabel(t, group)}
            enabled={enabled.has(group)}
            disabled={savingGroup !== null}
            onToggle={handleToggle}
          />
        ))}
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
      </View>
    </View>
  );
}

type ProviderCompactionLevel = "off" | "50" | "60" | "70" | "80" | "90";

// Mirrors the daemon's resolveAutoCompactDefault: autoCompact:false wins,
// otherwise thresholdPercent, otherwise the stock 80%.
function readProviderCompactionSettings(entry: Record<string, unknown> | null): {
  level: ProviderCompactionLevel;
  hideSelector: boolean;
} {
  const raw = entry?.["compaction"];
  const compaction =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const hideSelector = compaction?.["hideSelector"] === true;
  if (compaction?.["autoCompact"] === false) {
    return { level: "off", hideSelector };
  }
  const threshold = compaction?.["thresholdPercent"];
  const level =
    typeof threshold === "number" &&
    (COMPACTION_THRESHOLD_PERCENTS as readonly number[]).includes(threshold)
      ? (String(threshold) as ProviderCompactionLevel)
      : "80";
  return { level, hideSelector };
}

/**
 * Agent-behavior defaults for daemon-hosted providers (openai-compatible):
 * the default Auto-compact level applied to new chats, and whether each chat
 * shows its own Auto-compact selector or silently uses that default.
 */
function ProviderAgentsSection({
  provider,
  configEntry,
  patchConfig,
  refresh,
}: {
  provider: string;
  configEntry: Record<string, unknown> | null;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { level, hideSelector } = readProviderCompactionSettings(configEntry);

  const levelOptions = useMemo<SelectFieldOption<ProviderCompactionLevel>[]>(
    () => [
      {
        id: "off",
        value: "off",
        label: t("settings.providers.agents.compactionOff"),
        description: t("settings.providers.agents.compactionOffDescription"),
        testID: "provider-compaction-level-off",
      },
      ...COMPACTION_THRESHOLD_PERCENTS.map((percent) => ({
        id: String(percent),
        value: String(percent) as ProviderCompactionLevel,
        label: t("settings.providers.agents.compactionAtPercent", { percent }),
        testID: `provider-compaction-level-${percent}`,
      })),
    ],
    [t],
  );
  const selectedOption = levelOptions.find((option) => option.value === level) ?? null;
  const selectedDisplay = useMemo(
    () => (selectedOption ? { label: selectedOption.label } : null),
    [selectedOption],
  );

  const applyPatch = useCallback(
    (compaction: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      void patchConfig({ providers: { [provider]: { compaction } } })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.agents.saveFailed"));
        })
        .finally(() => setSaving(false));
    },
    [patchConfig, provider, refresh, t],
  );

  const handleLevelChange = useCallback(
    (next: ProviderCompactionLevel) => {
      applyPatch(
        next === "off"
          ? { autoCompact: false }
          : { autoCompact: true, thresholdPercent: Number(next) },
      );
    },
    [applyPatch],
  );

  const handleShowSelectorChange = useCallback(
    (next: boolean) => {
      applyPatch({ hideSelector: !next });
    },
    [applyPatch],
  );

  return (
    <View style={sheetStyles.section}>
      <View style={sheetStyles.connectionCard}>
        <View style={sheetStyles.formGroup}>
          <SelectField
            label={t("settings.providers.agents.compactionLabel")}
            hint={t("settings.providers.agents.compactionHint")}
            value={level}
            selectedDisplay={selectedDisplay}
            options={levelOptions}
            onChange={handleLevelChange}
            placeholder={t("settings.providers.agents.compactionLabel")}
            emptyText={t("settings.providers.agents.compactionLabel")}
            disabled={saving}
            size="sm"
            testID="provider-compaction-level"
            triggerTestID="provider-compaction-level-trigger"
          />
          <View style={sheetStyles.toolGroupRow}>
            <View style={sheetStyles.switchLabelGroup}>
              <Text style={sheetStyles.formLabel}>
                {t("settings.providers.agents.showSelectorLabel")}
              </Text>
              <Text style={sheetStyles.mutedText}>
                {t("settings.providers.agents.showSelectorDescription")}
              </Text>
            </View>
            <Switch
              value={!hideSelector}
              onValueChange={handleShowSelectorChange}
              disabled={saving}
              testID="provider-compaction-show-selector"
            />
          </View>
          {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function ProviderRemoveSection({
  provider,
  providerLabel,
  supportsRemove,
  patchConfig,
  onRemoved,
}: {
  provider: string;
  providerLabel: string;
  supportsRemove: boolean;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleOpenConfirm = useCallback(() => setConfirming(true), []);
  const handleCloseConfirm = useCallback(() => setConfirming(false), []);
  const handleConfirmRemove = useCallback(() => {
    setRemoving(true);
    void patchConfig({ providers: { [provider]: null } })
      .then(() => {
        setConfirming(false);
        onRemoved();
        return;
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : t("settings.providers.remove.failed"));
      })
      .finally(() => setRemoving(false));
  }, [onRemoved, patchConfig, provider, t, toast]);

  const removeIcon = useMemo(() => <ThemedRemoveIcon />, []);
  const confirmHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.remove.confirmTitle", { name: providerLabel }) }),
    [providerLabel, t],
  );

  return (
    <View style={sheetStyles.removeRow}>
      <Button
        variant="outline"
        size="sm"
        leftIcon={removeIcon}
        onPress={handleOpenConfirm}
        disabled={!supportsRemove}
        textStyle={sheetStyles.destructiveText}
        testID="provider-remove-button"
      >
        {t("settings.providers.remove.button")}
      </Button>
      {!supportsRemove ? (
        <Text style={sheetStyles.mutedText}>{t("settings.providers.remove.requiresUpdate")}</Text>
      ) : null}
      {confirming ? (
        <AdaptiveModalSheet
          header={confirmHeader}
          visible
          onClose={handleCloseConfirm}
          desktopMaxWidth={420}
          snapPoints={ADD_SNAP_POINTS}
          testID="provider-remove-confirm-sheet"
        >
          <View style={sheetStyles.formGroup}>
            <Text style={sheetStyles.mutedText}>
              {t("settings.providers.remove.confirmMessage")}
            </Text>
            <View style={sheetStyles.formActions}>
              <Button
                variant="secondary"
                size="sm"
                onPress={handleCloseConfirm}
                disabled={removing}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onPress={handleConfirmRemove}
                disabled={removing}
                loading={removing}
                testID="provider-remove-confirm"
              >
                {removing
                  ? t("settings.providers.remove.removing")
                  : t("settings.providers.remove.button")}
              </Button>
            </View>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </View>
  );
}

const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];

// Known model IDs for providers extending "claude" with a third-party
// Anthropic-compatible endpoint (Z.AI, Alibaba/Qwen — see
// docs/custom-providers.md). Still fully freeform via allowCustomValue.
const CLAUDE_COMPATIBLE_MODEL_ID_PRESETS: ComboboxOption[] = [
  { id: "glm-5.1", label: "GLM 5.1" },
  { id: "glm-5-turbo", label: "GLM 5 Turbo" },
  { id: "glm-4.7", label: "GLM 4.7" },
  { id: "glm-4.5-air", label: "GLM 4.5 Air" },
  { id: "qwen3.5-plus", label: "Qwen 3.5 Plus" },
  { id: "qwen3-coder-next", label: "Qwen 3 Coder Next" },
  { id: "qwen3-max", label: "Qwen 3 Max" },
  { id: "qwen3.5-flash", label: "Qwen 3.5 Flash" },
  { id: "kimi-k2.5", label: "Kimi K2.5" },
];

function AddCustomModelSubSheet({
  provider,
  serverId,
  extendsProvider,
  visible,
  onClose,
  refresh,
}: {
  provider: string;
  serverId: string;
  extendsProvider: string | null;
  visible: boolean;
  onClose: () => void;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const modelIdPresets =
    extendsProvider === "claude" ? CLAUDE_COMPATIBLE_MODEL_ID_PRESETS : EMPTY_COMBOBOX_OPTIONS;
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const trimmed = input.trim();
  const canAdd = trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  useEffect(() => {
    if (!visible) {
      setInput("");
      setError(null);
    }
  }, [visible]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    void patchConfig({
      providers: {
        [provider]: {
          additionalModels: [...additionalModels, { id: trimmed, label: trimmed }],
        },
      },
    })
      .then(() => refresh([provider]))
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("settings.providers.models.failedToSave"));
      })
      .finally(() => setSaving(false));
  }, [additionalModels, canAdd, onClose, patchConfig, provider, refresh, t, trimmed]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.models.addCustomTitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={420}
      snapPoints={ADD_SNAP_POINTS}
      testID="add-custom-model-sheet"
    >
      <View style={sheetStyles.formGroup}>
        <Text style={sheetStyles.formLabel}>{t("settings.providers.models.modelId")}</Text>
        <TextFieldPicker
          value={input}
          onChange={setInput}
          options={modelIdPresets}
          placeholder={t("settings.providers.models.modelIdPlaceholder")}
          testID="add-custom-model-id"
        />
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        <View style={sheetStyles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleAdd} disabled={!canAdd || saving}>
            {saving ? t("settings.providers.models.adding") : t("settings.providers.models.add")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && sheetStyles.iconButtonHovered,
      diagnostic ? null : sheetStyles.disabled,
    ],
    [diagnostic],
  );

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.setStringAsync(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <View style={sheetStyles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? (
              <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            ) : (
              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,
      theme.colors.foregroundMuted,
      theme.iconSize.sm,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>
      </SurfaceCard>
    );
  } else if (diagnostic) {
    body = (
      <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={480}>
        {diagnostic}
      </ScrollableCodeSurface>
    );
  } else {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

interface ProviderModalBodyProps {
  discoveredCount: number;
  additionalCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  filteredCustom: ProviderProfileModel[];
  deletingModelId: string | null;
  onRefresh: () => void;
  onDeleteCustom: (modelId: string) => void;
  theme: { iconSize: { md: number }; colors: { foregroundMuted: string } };
}

// Tab panes own their scrolling (the sheet is scrollable={false} so per-tab
// actions stay pinned), so each pane wires up the app's auto-hiding web
// scrollbar overlay instead of showing the native one.
function TabScrollView({ children }: { children: ReactNode }) {
  const isCompact = useIsCompactFormFactor();
  const showWebScrollbar = isWeb && !isCompact;
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: showWebScrollbar });

  return (
    <View style={sheetStyles.tabScroll}>
      <ScrollView
        ref={scrollRef}
        style={sheetStyles.tabScroll}
        contentContainerStyle={sheetStyles.tabScrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showWebScrollbar}
      >
        {children}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

interface ModelsTabActionsProps {
  fetchedAtLabel: string | null;
  modelsRefreshing: boolean;
  onOpenAddSheet: () => void;
  onOpenDiagSheet: () => void;
  onRefreshModels: () => void;
}

// Model-management actions pinned below the Models tab's scrolling list. The
// "Updated" label reports when the model list was last fetched.
function ModelsTabActions({
  fetchedAtLabel,
  modelsRefreshing,
  onOpenAddSheet,
  onOpenDiagSheet,
  onRefreshModels,
}: ModelsTabActionsProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const contentStyle = isCompact ? sheetStyles.compactFooterContent : sheetStyles.footerContent;
  const actionsStyle = isCompact ? sheetStyles.compactFooterActions : sheetStyles.footerActions;
  const buttonStyle = isCompact ? sheetStyles.compactFooterButton : null;
  const metaStyle = isCompact ? COMPACT_FOOTER_META_STYLE : sheetStyles.footerMeta;

  return (
    <View style={contentStyle}>
      {fetchedAtLabel || !isCompact ? (
        <Text style={metaStyle} numberOfLines={1}>
          {fetchedAtLabel ? t("settings.providers.models.updated", { time: fetchedAtLabel }) : ""}
        </Text>
      ) : null}
      <View style={actionsStyle}>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={Plus}
          onPress={onOpenAddSheet}
          style={buttonStyle}
        >
          {t("settings.providers.models.addModel")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={FileText}
          onPress={onOpenDiagSheet}
          style={buttonStyle}
        >
          {t("settings.providers.diagnostic.button")}
        </Button>
        <Button
          variant="default"
          size="sm"
          leftIcon={modelsRefreshing ? undefined : RotateCw}
          onPress={onRefreshModels}
          disabled={modelsRefreshing}
          style={buttonStyle}
        >
          {modelsRefreshing
            ? t("settings.providers.diagnostic.refreshing")
            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </View>
    </View>
  );
}

function ProviderModalBody(props: ProviderModalBodyProps) {
  const { t } = useTranslation();
  const {
    discoveredCount,
    additionalCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    filteredCustom,
    deletingModelId,
    onRefresh,
    onDeleteCustom,
    theme,
  } = props;

  if (discoveredCount === 0 && additionalCount === 0 && providerSnapshotRefreshing) {
    return (
      <View style={sheetStyles.emptyState}>
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.loading")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0 && providerErrorMessage) {
    return (
      <View style={sheetStyles.emptyState}>
        <AlertTriangle size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{providerErrorMessage}</Text>
        <Button variant="default" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing
            ? t("settings.providers.models.retrying")
            : t("settings.providers.models.retry")}
        </Button>
      </View>
    );
  }
  if (filteredDiscovered.length === 0 && filteredCustom.length === 0 && searchActive) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noSearchMatches")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noneDetected")}</Text>
      </View>
    );
  }
  return (
    <>
      {filteredDiscovered.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader
            title={t("settings.providers.models.discovered")}
            count={filteredDiscovered.length}
          />
          <View style={settingsStyles.card}>
            {filteredDiscovered.map((model) => (
              <DiscoveredModelRow key={model.id} model={model} />
            ))}
          </View>
        </View>
      ) : null}
      {filteredCustom.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader
            title={t("settings.providers.models.custom")}
            count={filteredCustom.length}
          />
          <View style={settingsStyles.card}>
            {filteredCustom.map((model) => (
              <CustomModelRow
                key={model.id}
                model={model}
                deleting={deletingModelId === model.id}
                onDelete={onDeleteCustom}
              />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { entries: snapshotEntries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ProviderSettingsTab | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const providerConfigEntry = readProviderConfigEntry(config, provider);
  const providerExtends = readProviderExtends(providerConfigEntry);
  const isCustomProvider = providerExtends !== null;
  const connection = useMemo(
    () => resolveProviderConnection(providerConfigEntry, providerExtends),
    [providerConfigEntry, providerExtends],
  );
  const supportsProviderRemove = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerRemove === true,
  );
  const handleRemoved = useCallback(() => {
    onClose();
  }, [onClose]);
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;

  const stableDiscoveredRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const currentModels = providerEntry?.models;
  const { models: discoveredModels, cache: nextDiscoveredCache } = resolveProviderDiscoveredModels({
    serverId,
    provider,
    currentModels,
    providerSnapshotRefreshing,
    previousCache: stableDiscoveredRef.current,
  });
  stableDiscoveredRef.current = nextDiscoveredCache;

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    return () => clearInterval(id);
  }, [visible]);
  const fetchedAtLabel = useMemo(() => {
    if (!providerEntry?.fetchedAt) return null;
    void clockTick;
    return formatTimeAgo(new Date(providerEntry.fetchedAt));
  }, [providerEntry?.fetchedAt, clockTick]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setActiveTab(null);
      setAddSheetOpen(false);
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const hasConnectionTab = connection !== null;
  const hasToolsTab = providerExtends === "openai-compatible";
  const hasAgentsTab = providerExtends === "openai-compatible";
  const tabOptions = useMemo(
    () => buildProviderTabOptions(t, hasConnectionTab, hasToolsTab, hasAgentsTab),
    [hasAgentsTab, hasConnectionTab, hasToolsTab, t],
  );
  // Falls back to the first tab until the user picks one, or if a config
  // refresh drops the selected tab (e.g. the provider loses its connection).
  const currentTab = resolveCurrentTab(activeTab, tabOptions);

  const q = query.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, q, (m) => [m.label, m.id]),
    [additionalModels, q],
  );

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleOpenAddSheet = useCallback(() => setAddSheetOpen(true), []);
  const handleCloseAddSheet = useCallback(() => setAddSheetOpen(false), []);
  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const handleDeleteCustom = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      void patchConfig({
        providers: {
          [provider]: {
            additionalModels: additionalModels.filter((model) => model.id !== modelId),
          },
        },
      })
        .then(() => refresh([provider]))
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [additionalModels, patchConfig, provider, refresh],
  );

  const sheetHeader = useMemo<SheetHeader>(() => ({ title: providerLabel }), [providerLabel]);

  // Pinned sheet footer, visible on every tab. Only custom providers (config
  // entries with `extends`) are removable; built-ins get no footer.
  const removeFooter = useMemo(
    () =>
      isCustomProvider ? (
        <ProviderRemoveSection
          provider={provider}
          providerLabel={providerLabel}
          supportsRemove={supportsProviderRemove}
          patchConfig={patchConfig}
          onRemoved={handleRemoved}
        />
      ) : undefined,
    [handleRemoved, isCustomProvider, patchConfig, provider, providerLabel, supportsProviderRemove],
  );

  const tabStrip = useMemo(
    () => (
      <View style={sheetStyles.tabStrip}>
        <SegmentedControl
          size="sm"
          value={currentTab}
          onValueChange={setActiveTab}
          options={tabOptions}
          testID="provider-settings-tabs"
        />
      </View>
    ),
    [currentTab, tabOptions],
  );

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose}
        testID="provider-settings-sheet"
        subHeader={tabStrip}
        desktopHeight={DESKTOP_SHEET_HEIGHT}
        scrollable={false}
        footer={removeFooter}
        snapPoints={MAIN_SNAP_POINTS}
      >
        {currentTab === "models" ? (
          <View style={sheetStyles.tabPane}>
            <ModelsSearchField initialValue={query} onChange={setQuery} />
            <TabScrollView>
              <ProviderModalBody
                discoveredCount={discoveredModels.length}
                additionalCount={additionalModels.length}
                providerSnapshotRefreshing={providerSnapshotRefreshing}
                providerErrorMessage={providerErrorMessage}
                modelsRefreshing={modelsRefreshing}
                searchActive={Boolean(q)}
                filteredDiscovered={filteredDiscovered}
                filteredCustom={filteredCustom}
                deletingModelId={deletingModelId}
                onRefresh={handleRefreshModels}
                onDeleteCustom={handleDeleteCustom}
                theme={theme}
              />
            </TabScrollView>
            <ModelsTabActions
              fetchedAtLabel={fetchedAtLabel}
              modelsRefreshing={modelsRefreshing}
              onOpenAddSheet={handleOpenAddSheet}
              onOpenDiagSheet={handleOpenDiagSheet}
              onRefreshModels={handleRefreshModels}
            />
          </View>
        ) : null}
        {currentTab === "connection" && connection ? (
          <TabScrollView>
            <ProviderConnectionSection
              key={`connection-${provider}`}
              provider={provider}
              connection={connection}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
        {currentTab === "tools" ? (
          <TabScrollView>
            <ProviderToolGroupsSection
              key={`tools-${provider}`}
              provider={provider}
              selectedGroups={config?.providers?.[provider]?.ottoToolGroups ?? null}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
        {currentTab === "agents" ? (
          <TabScrollView>
            <ProviderAgentsSection
              key={`agents-${provider}`}
              provider={provider}
              configEntry={providerConfigEntry}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
      </AdaptiveModalSheet>
      <AddCustomModelSubSheet
        provider={provider}
        serverId={serverId}
        extendsProvider={providerExtends}
        visible={addSheetOpen}
        onClose={handleCloseAddSheet}
        refresh={refresh}
      />
      <DiagnosticSubSheet
        provider={provider}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

const sheetStyles = StyleSheet.create((theme) => ({
  mutedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  monoHint: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  descriptionInline: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  formInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.sm,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  // Fixed strip between the sheet header and the scrolling tab content. Row
  // direction keeps the segmented control at its intrinsic width.
  tabStrip: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
  },
  // Fills the sheet's static content area: fixed rows (search, actions)
  // sandwich the scrolling list.
  tabPane: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
  },
  tabScroll: {
    flex: 1,
    minHeight: 0,
  },
  tabScrollContent: {
    paddingBottom: theme.spacing[2],
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  modelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  modelRowFiller: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  footerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  compactFooterContent: {
    gap: theme.spacing[2],
  },
  footerMeta: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  compactFooterMeta: {
    flex: 0,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  compactFooterActions: {
    gap: theme.spacing[2],
  },
  compactFooterButton: {
    alignSelf: "stretch",
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  connectionCard: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
  },
  removeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  destructiveText: {
    color: theme.colors.destructive,
  },
  formLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  toolGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  toolGroupLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  switchLabelGroup: {
    flex: 1,
    gap: theme.spacing[1],
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

const FORM_INPUT_STYLE = [sheetStyles.formInput, isWeb && { outlineStyle: "none" }];
const MODELS_SEARCH_INPUT_STYLE = [sheetStyles.searchInput, isWeb && { outlineStyle: "none" }];
const COMPACT_FOOTER_META_STYLE = [sheetStyles.footerMeta, sheetStyles.compactFooterMeta];

const MAIN_SNAP_POINTS = ["65%", "92%"];
// One size for every provider's settings dialog — tab content scrolls inside.
const DESKTOP_SHEET_HEIGHT = 640;
const ADD_SNAP_POINTS = ["40%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];
