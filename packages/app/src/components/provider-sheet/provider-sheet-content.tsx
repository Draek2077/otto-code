import { Check, FileText, Plus, RotateCw, Search, Trash2 } from "@/components/icons/material-icons";
import type { TFunction } from "i18next";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useSessionStore } from "@/stores/session-store";
import { modelTierLabel } from "@/utils/model-tier-label";
import type { AgentProvider, ModelTier } from "@otto-code/protocol/agent-types";
import type {
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  SavedProviderEndpoint,
} from "@otto-code/protocol/messages";
import {
  findSavedProviderEndpoint,
  forgetProviderEndpoint,
  rememberProviderEndpoint,
  selectSavedProviderEndpoints,
} from "@/utils/saved-provider-endpoints";
import {
  ACTION_BREAKER_DEFAULT_THRESHOLD,
  COMPACTION_THRESHOLD_PERCENTS,
  MAX_TOOL_ROUNDS_DEFAULT,
  OTTO_TOOL_GROUPS,
  serializeOttoToolGroups,
  type OttoToolGroup,
} from "@otto-code/protocol/provider-config";
import { Switch } from "@/components/ui/switch";
import { NumberStepperField } from "@/components/ui/number-stepper-field";
import { Field } from "@/components/ui/form-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { type SegmentedControlOption } from "@/components/ui/segmented-control";
import { TextFieldPicker, type ComboboxOption } from "@/components/ui/text-field-picker";

/**
 * The Otto provider-sheet implementation: the settings, agents and connection
 * sections, model rows, tab plumbing and helpers that ProviderDiagnosticSheet
 * renders. Otto-only code, so it lives in its own module; Paseo's
 * provider-diagnostic-sheet.tsx keeps the sheet shell and composes this.
 */

// Duplicated from provider-diagnostic-sheet.tsx (golden's constant): this module
// must not import the Paseo file. Keep in sync.
const ADD_SNAP_POINTS = ["40%"];

export const ThemedRemoveIcon = withUnistyles(Trash2, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.destructive,
}));

export type ProviderSettingsTab = "models" | "connection" | "tools" | "agents";

export function buildProviderTabOptions(
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
export function resolveCurrentTab(
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

const ThemedModelVisibilityCheck = withUnistyles(Check, (theme) => ({
  size: theme.iconSize.xs,
  color: theme.colors.accentForeground,
}));

export function ModelVisibilityCheckbox({
  modelId,
  visible,
  disabled,
  onChange,
}: {
  modelId: string;
  visible: boolean;
  disabled: boolean;
  onChange: (modelId: string, visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ checked: visible, disabled }), [disabled, visible]);
  const checkboxStyle = useMemo(
    () => [
      sheetStyles.modelVisibilityCheckbox,
      visible ? sheetStyles.modelVisibilityCheckboxChecked : null,
      disabled ? sheetStyles.modelVisibilityCheckboxDisabled : null,
    ],
    [disabled, visible],
  );
  const handlePress = useCallback(() => onChange(modelId, !visible), [modelId, onChange, visible]);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={t("settings.providers.models.visibilityLabel", { id: modelId })}
      accessibilityState={accessibilityState}
      aria-checked={visible}
      disabled={disabled}
      hitSlop={6}
      onPress={handlePress}
      style={checkboxStyle}
      testID={`model-visibility-${modelId}`}
    >
      {visible ? <ThemedModelVisibilityCheck /> : null}
    </Pressable>
  );
}

export function ModelsSearchField({
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

// A model's tier as shown in the dropdown. "unknown" is the sentinel for "no
// tier" - picking it clears any user override (reverting to the catalog value if
// we know one, else genuinely Unknown). See model-tiers.ts.
// TODO(i18n): inline English, translated in a later pass.
const MODEL_TIER_OPTIONS: SelectFieldOption<ModelTier | "unknown">[] = [
  { id: "deep", value: "deep", label: "Deep" },
  { id: "standard", value: "standard", label: "Standard" },
  { id: "fast", value: "fast", label: "Fast" },
  { id: "unknown", value: "unknown", label: "Unknown" },
];

// Compact per-model tier picker. `tier` is the daemon-stamped effective tier
// (user override → catalog, else undefined = Unknown). Selecting a tier sets an
// override; selecting "Unknown" clears it.
export function ModelTierSelect({
  modelId,
  tier,
  disabled,
  onChange,
}: {
  modelId: string;
  tier: ModelTier | undefined;
  disabled: boolean;
  onChange: (modelId: string, tier: ModelTier | null) => void;
}) {
  const display = useMemo(() => ({ label: modelTierLabel(tier) }), [tier]);
  const handleChange = useCallback(
    (next: ModelTier | "unknown") => {
      onChange(modelId, next === "unknown" ? null : next);
    },
    [modelId, onChange],
  );
  return (
    <SelectField<ModelTier | "unknown">
      field={false}
      size="sm"
      label="Model tier"
      value={tier ?? "unknown"}
      selectedDisplay={display}
      options={MODEL_TIER_OPTIONS}
      onChange={handleChange}
      placeholder="Unknown"
      emptyText="Unknown"
      disabled={disabled}
      testID={`model-tier-${modelId}`}
      triggerTestID={`model-tier-trigger-${modelId}`}
    />
  );
}

// The shrinkable text region of a model row: the friendly Name and stable ID
// get their own lines so the trailing control can stay vertically centered.
// Both lines ellipsize; hovering reveals the full values and description.
export function ModelRowText({
  label,
  id,
  description,
}: {
  label: string;
  id: string;
  description?: string;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <View style={sheetStyles.modelRowText}>
          <View style={sheetStyles.modelFieldRow}>
            <Text style={sheetStyles.modelTitle} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <View style={sheetStyles.modelFieldRow}>
            <Text
              style={sheetStyles.monoHint}
              numberOfLines={1}
              selectable
              dataSet={CODE_SURFACE_DATASET}
            >
              {id}
            </Text>
          </View>
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" offset={4} maxWidth={480}>
        <View style={sheetStyles.modelTooltip}>
          <Text style={sheetStyles.modelTooltipTitle}>{label}</Text>
          <Text style={sheetStyles.modelTooltipMono} dataSet={CODE_SURFACE_DATASET}>
            {id}
          </Text>
          {description ? (
            <Text style={sheetStyles.modelTooltipDescription}>{description}</Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

interface ProviderConnectionDescriptor {
  baseUrlKey: string;
  apiKeyKey: string;
  baseUrl: string;
  apiKey: string;
}

export function readProviderConfigEntry(
  config: MutableDaemonConfig | null,
  provider: string,
): Record<string, unknown> | null {
  const entry = config?.providers?.[provider];
  return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
}

export function readProviderExtends(entry: Record<string, unknown> | null): string | null {
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

/**
 * The built-in local AI host. Its endpoint and credential are derived from the
 * brain settings (Settings → Host → Otto Brain), so it never gets a Connection
 * tab - even when an older install left an `extends: openai-compatible` entry
 * behind from the days it was added from the provider catalog.
 */
const OTTO_BRAIN_PROVIDER_ID = "otto-brain";

/**
 * Whether the provider is user-defined (removable, endpoint-editable). An older
 * install can still carry an `extends: openai-compatible` entry for otto-brain
 * from when it was added from the provider catalog; it is built in regardless.
 */
export function resolveIsCustomProvider(provider: string, extendsProvider: string | null): boolean {
  return extendsProvider !== null && provider !== OTTO_BRAIN_PROVIDER_ID;
}

/**
 * Whether this provider behaves like an openai-compatible client for the
 * Tools/Agents tabs (ottoToolGroups, compaction, maxToolRounds). Otto Brain
 * qualifies even though its config entry never carries `extends` - the
 * endpoint comes from brain settings, not the provider catalog - because it is
 * an OpenAICompatAgentClient under the hood (see provider-registry.ts).
 */
export function resolveIsOpenAiCompatFamily(
  provider: string,
  extendsProvider: string | null,
): boolean {
  return extendsProvider === "openai-compatible" || provider === OTTO_BRAIN_PROVIDER_ID;
}

export function resolveProviderConnection(
  provider: string,
  entry: Record<string, unknown> | null,
  extendsProvider: string | null,
): ProviderConnectionDescriptor | null {
  if (provider === OTTO_BRAIN_PROVIDER_ID) {
    return null;
  }
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

// Stable identity for "this host remembers nothing yet", so the connection
// section isn't handed a fresh array on every render.
export const EMPTY_SAVED_ENDPOINTS: SavedProviderEndpoint[] = [];

type ProviderSheetFeature =
  | "providerRemove"
  | "artifactsToolGroup"
  | "modelTierOverrides"
  | "modelVisibilityOverrides"
  | "savedProviderEndpoints"
  | "openaiCompatMaxToolRounds"
  | "openaiCompatActionBreaker"
  | "openaiCompatMidSessionUpdates";

/** Read one daemon capability gate off the connected host's server_info. */
export function useProviderSheetFeature(serverId: string, feature: ProviderSheetFeature): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.[feature] === true,
  );
}

// Merge the host's remembered endpoints in front of the shipped presets. Saved
// entries win on duplicate URLs - a preset the user has actually connected to
// carries their credential, so offering it twice would be a coin flip over
// which one fills the key field.
function buildBaseUrlOptions(params: {
  t: TFunction;
  presets: ComboboxOption[];
  saved: SavedProviderEndpoint[];
}): ComboboxOption[] {
  const { t, presets, saved } = params;
  const savedUrls = new Set(saved.map((entry) => entry.baseUrl));
  return [
    ...saved.map((entry) => ({
      id: entry.baseUrl,
      label: entry.label ?? entry.baseUrl,
      description: entry.apiKey
        ? t("settings.providers.connection.savedWithKey")
        : t("settings.providers.connection.savedNoKey"),
    })),
    ...presets.filter((preset) => !savedUrls.has(preset.id)),
  ];
}

export function ProviderConnectionSection({
  provider,
  connection,
  savedEndpoints,
  supportsSavedEndpoints,
  patchConfig,
  refresh,
}: {
  provider: string;
  connection: ProviderConnectionDescriptor;
  savedEndpoints: SavedProviderEndpoint[];
  supportsSavedEndpoints: boolean;
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

  const familyEndpoints = useMemo(
    () =>
      supportsSavedEndpoints
        ? selectSavedProviderEndpoints(savedEndpoints, connection.baseUrlKey)
        : [],
    [connection.baseUrlKey, savedEndpoints, supportsSavedEndpoints],
  );
  const baseUrlOptions = useMemo(
    () => buildBaseUrlOptions({ t, presets: baseUrlPresets, saved: familyEndpoints }),
    [baseUrlPresets, familyEndpoints, t],
  );
  // Only offer "forget" for the endpoint currently in the field, so the
  // dropdown stays a picker instead of growing per-row management chrome.
  const savedMatch = useMemo(
    () => findSavedProviderEndpoint(familyEndpoints, connection.baseUrlKey, baseUrl.trim()),
    [baseUrl, connection.baseUrlKey, familyEndpoints],
  );

  // Picking a remembered endpoint swaps the credential with it - that pairing
  // is the whole point of remembering them. A URL with no saved entry (a preset
  // or something freeform) leaves whatever key is already typed alone.
  const handleBaseUrlChange = useCallback(
    (next: string) => {
      setBaseUrl(next);
      const match = findSavedProviderEndpoint(familyEndpoints, connection.baseUrlKey, next.trim());
      if (match) {
        setApiKey(match.apiKey);
      }
    },
    [connection.baseUrlKey, familyEndpoints],
  );

  const handleSave = useCallback(() => {
    if (!canSave) return;
    const nextBaseUrl = baseUrl.trim();
    const nextApiKey = apiKey.trim();
    setSaving(true);
    setError(null);
    void patchConfig({
      providers: {
        [provider]: {
          env: {
            [connection.baseUrlKey]: nextBaseUrl,
            [connection.apiKeyKey]: nextApiKey,
          },
        },
      },
      // Saving is also what remembers the endpoint - a separate button is one
      // more thing to forget, and forgetting it loses the key.
      ...(supportsSavedEndpoints
        ? {
            savedProviderEndpoints: rememberProviderEndpoint({
              endpoints: savedEndpoints,
              baseUrlKey: connection.baseUrlKey,
              apiKeyKey: connection.apiKeyKey,
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              savedAt: Date.now(),
            }),
          }
        : {}),
    })
      .then(() => refresh([provider]))
      .then(() => toast.show(t("settings.providers.connection.saved"), { variant: "success" }))
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : t("settings.providers.connection.saveFailed"),
        );
      })
      .finally(() => setSaving(false));
  }, [
    apiKey,
    baseUrl,
    canSave,
    connection,
    patchConfig,
    provider,
    refresh,
    savedEndpoints,
    supportsSavedEndpoints,
    t,
    toast,
  ]);

  // Forgetting only drops the remembered copy; the provider keeps whatever
  // endpoint it is currently pointed at.
  const handleForget = useCallback(() => {
    if (!savedMatch || saving) return;
    setError(null);
    void patchConfig({
      savedProviderEndpoints: forgetProviderEndpoint(savedEndpoints, savedMatch.id),
    })
      .then(() => toast.show(t("settings.providers.connection.forgot"), { variant: "success" }))
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : t("settings.providers.connection.saveFailed"),
        );
      });
  }, [patchConfig, savedEndpoints, savedMatch, saving, t, toast]);

  return (
    <View style={sheetStyles.section}>
      <View style={sheetStyles.connectionCard}>
        <View style={sheetStyles.formGroup}>
          <Text style={sheetStyles.formLabel}>{t("settings.providers.connection.baseUrl")}</Text>
          <TextFieldPicker
            value={baseUrl}
            onChange={handleBaseUrlChange}
            options={baseUrlOptions}
            placeholder="http://localhost:1234/v1"
            testID="provider-connection-base-url"
          />
          {savedMatch ? (
            <View style={sheetStyles.formActions}>
              <Button
                variant="ghost"
                size="sm"
                onPress={handleForget}
                testID="provider-connection-forget-endpoint"
              >
                {t("settings.providers.connection.forget")}
              </Button>
            </View>
          ) : null}
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
    case "artifacts":
      return t("settings.providers.tools.groups.artifacts");
    case "widgets":
      return t("settings.providers.tools.groups.widgets");
    case "workspace":
      return t("settings.providers.tools.groups.workspace");
    case "orchestration":
      return t("settings.providers.tools.groups.orchestration");
    case "knowledge":
      return t("settings.providers.tools.groups.knowledge");
    case "memory":
      return t("settings.providers.tools.groups.memory");
    case "permissions":
      return t("settings.providers.tools.groups.permissions");
    case "providers":
      return t("settings.providers.tools.groups.providers");
    case "tasks":
      return t("settings.providers.tools.groups.tasks");
    case "voice":
      return t("settings.providers.tools.groups.voice");
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
export function ProviderToolGroupsSection({
  provider,
  selectedGroups,
  supportsArtifactsGroup,
  patchConfig,
  refresh,
}: {
  provider: string;
  selectedGroups: readonly OttoToolGroup[] | null;
  supportsArtifactsGroup: boolean;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [savingGroup, setSavingGroup] = useState<OttoToolGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  // COMPAT(artifactsToolGroup): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
  // Old daemons reject "artifacts" in ottoToolGroups patches, so hide the
  // toggle and keep the value out of written lists until the daemon declares it.
  const availableGroups = useMemo(
    () =>
      supportsArtifactsGroup
        ? OTTO_TOOL_GROUPS
        : OTTO_TOOL_GROUPS.filter((group) => group !== "artifacts"),
    [supportsArtifactsGroup],
  );

  const enabled = useMemo(
    () => new Set<OttoToolGroup>(selectedGroups ?? availableGroups),
    [selectedGroups, availableGroups],
  );

  const handleToggle = useCallback(
    (group: OttoToolGroup, next: boolean) => {
      const nextSet = new Set(enabled);
      if (next) {
        nextSet.add(group);
      } else {
        nextSet.delete(group);
      }
      const nextGroups = availableGroups.filter((candidate) => nextSet.has(candidate));
      setSavingGroup(group);
      setError(null);
      // COMPAT(ottoToolGroupsV2): write both shapes. The v2 key is what a
      // current daemon reads; the legacy key collapses the categories split out
      // of "agents" back into it, so a daemon that predates the split still
      // injects the tools the user left enabled.
      const { toolGroups, toolGroupsV2 } = serializeOttoToolGroups(nextGroups);
      void patchConfig({
        providers: {
          [provider]: { ottoToolGroups: toolGroups, ottoToolGroupsV2: toolGroupsV2 },
        },
      })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.tools.saveFailed"));
        })
        .finally(() => setSavingGroup((current) => (current === group ? null : current)));
    },
    [availableGroups, enabled, patchConfig, provider, refresh, t],
  );

  return (
    <View style={sheetStyles.section}>
      <View style={sheetStyles.connectionCard}>
        <Text style={sheetStyles.formLabel}>{t("settings.providers.tools.description")}</Text>
        {availableGroups.map((group) => (
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

// Selectable max-tool-rounds presets. The schema accepts any 1–1000 value
// (config.json can hold an off-preset number); the dropdown covers the useful
// range and always renders the current value even when it isn't a preset.
const MAX_TOOL_ROUNDS_PRESETS = [25, 50, 100, 200, 500] as const;

function readProviderMaxToolRounds(entry: Record<string, unknown> | null): number {
  const raw = entry?.["maxToolRounds"];
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.round(raw)
    : MAX_TOOL_ROUNDS_DEFAULT;
}

function readProviderActionBreaker(entry: Record<string, unknown> | null): {
  enabled: boolean;
  threshold: number;
} {
  const raw = entry?.["actionBreaker"];
  const breaker =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  return {
    enabled: breaker?.["enabled"] === true,
    threshold:
      typeof breaker?.["threshold"] === "number"
        ? breaker.threshold
        : ACTION_BREAKER_DEFAULT_THRESHOLD,
  };
}

/**
 * Whether the daemon-hosted tool loop may add context to a conversation after
 * it started. Absent means on: that is the shipped behavior, and the switch
 * exists to turn it off for a small local context window.
 */
function readProviderMidSessionContextUpdates(entry: Record<string, unknown> | null): boolean {
  return entry?.["midSessionContextUpdates"] !== false;
}

/**
 * Agent-behavior defaults for daemon-hosted providers (openai-compatible):
 * the default Auto-compact level applied to new chats, whether each chat shows
 * its own Auto-compact selector, and the per-turn max tool-rounds safety valve.
 */
export function ProviderAgentsSection({
  provider,
  configEntry,
  supportsMaxToolRounds,
  supportsActionBreaker,
  supportsMidSessionUpdates,
  patchConfig,
  refresh,
}: {
  provider: string;
  configEntry: Record<string, unknown> | null;
  supportsMaxToolRounds: boolean;
  supportsActionBreaker: boolean;
  supportsMidSessionUpdates: boolean;
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

  const maxToolRounds = readProviderMaxToolRounds(configEntry);
  const maxToolRoundsOptions = useMemo<SelectFieldOption<number>[]>(() => {
    const presets: number[] = [...MAX_TOOL_ROUNDS_PRESETS];
    // Surface an off-preset config.json value as its own selectable entry so the
    // dropdown never silently drops it.
    if (!presets.includes(maxToolRounds)) {
      presets.push(maxToolRounds);
      presets.sort((a, b) => a - b);
    }
    return presets.map((rounds) => ({
      id: String(rounds),
      value: rounds,
      label: t("settings.providers.agents.maxToolRoundsValue", { rounds }),
      testID: `provider-max-tool-rounds-${rounds}`,
    }));
  }, [maxToolRounds, t]);
  const maxToolRoundsDisplay = useMemo(
    () => ({ label: t("settings.providers.agents.maxToolRoundsValue", { rounds: maxToolRounds }) }),
    [maxToolRounds, t],
  );

  const handleMaxToolRoundsChange = useCallback(
    (next: number) => {
      setSaving(true);
      setError(null);
      void patchConfig({ providers: { [provider]: { maxToolRounds: next } } })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.agents.saveFailed"));
        })
        .finally(() => setSaving(false));
    },
    [patchConfig, provider, refresh, t],
  );

  const actionBreaker = readProviderActionBreaker(configEntry);

  const handleActionBreakerEnabledChange = useCallback(
    (next: boolean) => {
      setSaving(true);
      setError(null);
      void patchConfig({
        providers: {
          [provider]: { actionBreaker: { enabled: next, threshold: actionBreaker.threshold } },
        },
      })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.agents.saveFailed"));
        })
        .finally(() => setSaving(false));
    },
    [patchConfig, provider, refresh, t, actionBreaker.threshold],
  );

  const handleActionBreakerThresholdChange = useCallback(
    (next: number) => {
      setSaving(true);
      setError(null);
      void patchConfig({
        providers: {
          [provider]: { actionBreaker: { enabled: actionBreaker.enabled, threshold: next } },
        },
      })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.agents.saveFailed"));
        })
        .finally(() => setSaving(false));
    },
    [patchConfig, provider, refresh, t, actionBreaker.enabled],
  );

  const midSessionContextUpdates = readProviderMidSessionContextUpdates(configEntry);

  const handleMidSessionUpdatesChange = useCallback(
    (next: boolean) => {
      setSaving(true);
      setError(null);
      void patchConfig({ providers: { [provider]: { midSessionContextUpdates: next } } })
        .then(() => refresh([provider]))
        .catch((err) => {
          setError(err instanceof Error ? err.message : t("settings.providers.agents.saveFailed"));
        })
        .finally(() => setSaving(false));
    },
    [patchConfig, provider, refresh, t],
  );

  // NumberStepperField owns its text, so a blank or garbage entry reads as the
  // default rather than 0 (which is below the breaker's minimum).
  const handleActionBreakerThresholdText = useCallback(
    (text: string) => {
      handleActionBreakerThresholdChange(Number(text) || ACTION_BREAKER_DEFAULT_THRESHOLD);
    },
    [handleActionBreakerThresholdChange],
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
          {supportsMaxToolRounds ? (
            <SelectField<number>
              label={t("settings.providers.agents.maxToolRoundsLabel")}
              hint={t("settings.providers.agents.maxToolRoundsHint")}
              value={maxToolRounds}
              selectedDisplay={maxToolRoundsDisplay}
              options={maxToolRoundsOptions}
              onChange={handleMaxToolRoundsChange}
              placeholder={t("settings.providers.agents.maxToolRoundsLabel")}
              emptyText={t("settings.providers.agents.maxToolRoundsLabel")}
              disabled={saving}
              size="sm"
              testID="provider-max-tool-rounds"
              triggerTestID="provider-max-tool-rounds-trigger"
            />
          ) : (
            <Text style={sheetStyles.mutedText}>
              {t("settings.providers.agents.maxToolRoundsRequiresUpdate")}
            </Text>
          )}
          {supportsActionBreaker ? (
            <>
              <View style={sheetStyles.toolGroupRow}>
                <View style={sheetStyles.switchLabelGroup}>
                  <Text style={sheetStyles.formLabel}>
                    {t("settings.providers.agents.actionBreakerLabel")}
                  </Text>
                  <Text style={sheetStyles.mutedText}>
                    {t("settings.providers.agents.actionBreakerHint")}
                  </Text>
                </View>
                <Switch
                  value={actionBreaker.enabled}
                  onValueChange={handleActionBreakerEnabledChange}
                  disabled={saving}
                  testID="provider-action-breaker-enabled"
                />
              </View>
              {actionBreaker.enabled ? (
                <Field
                  label={t("settings.providers.agents.actionBreakerThresholdLabel")}
                  hint={t("settings.providers.agents.actionBreakerThresholdHint")}
                >
                  <NumberStepperField
                    size="sm"
                    testID="provider-action-breaker-threshold"
                    accessibilityLabel={t("settings.providers.agents.actionBreakerThresholdLabel")}
                    value={String(actionBreaker.threshold)}
                    onChangeText={handleActionBreakerThresholdText}
                    min={2}
                    max={100}
                    decrementLabel={t("settings.providers.agents.actionBreakerThresholdDecrease")}
                    incrementLabel={t("settings.providers.agents.actionBreakerThresholdIncrease")}
                  />
                </Field>
              ) : null}
            </>
          ) : (
            <Text style={sheetStyles.mutedText}>
              {t("settings.providers.agents.actionBreakerRequiresUpdate")}
            </Text>
          )}
          {supportsMidSessionUpdates ? (
            <View style={sheetStyles.toolGroupRow}>
              <View style={sheetStyles.switchLabelGroup}>
                <Text style={sheetStyles.formLabel}>
                  {t("settings.providers.agents.midSessionUpdatesLabel")}
                </Text>
                <Text style={sheetStyles.mutedText}>
                  {t("settings.providers.agents.midSessionUpdatesHint")}
                </Text>
              </View>
              <Switch
                value={midSessionContextUpdates}
                onValueChange={handleMidSessionUpdatesChange}
                disabled={saving}
                testID="provider-mid-session-updates"
              />
            </View>
          ) : (
            <Text style={sheetStyles.mutedText}>
              {t("settings.providers.agents.midSessionUpdatesRequiresUpdate")}
            </Text>
          )}
          {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

export function ProviderRemoveSection({
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
  const confirmFooter = useMemo(
    () => (
      <View style={sheetStyles.sheetFooter}>
        <Button
          style={sheetStyles.sheetFooterButton}
          variant="secondary"
          size="sm"
          onPress={handleCloseConfirm}
          disabled={removing}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={sheetStyles.sheetFooterButton}
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
    ),
    [handleCloseConfirm, handleConfirmRemove, removing, t],
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
          footer={confirmFooter}
          testID="provider-remove-confirm-sheet"
        >
          <View style={sheetStyles.formGroup}>
            <Text style={sheetStyles.mutedText}>
              {t("settings.providers.remove.confirmMessage")}
            </Text>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </View>
  );
}

export const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];

// Known model IDs for providers extending "claude" with a third-party
// Anthropic-compatible endpoint (Z.AI, Alibaba/Qwen - see
// docs/custom-providers.md). Still fully freeform via allowCustomValue.
export const CLAUDE_COMPATIBLE_MODEL_ID_PRESETS: ComboboxOption[] = [
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

interface ModelsTabActionsProps {
  fetchedAtLabel: string | null;
  modelsRefreshing: boolean;
  onOpenAddSheet: () => void;
  onOpenDiagSheet: () => void;
  onRefreshModels: () => void;
}

// Model-management actions pinned below the Models tab's scrolling list. The
// "Updated" label reports when the model list was last fetched.
export function ModelsTabActions({
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

// One size for every provider's settings dialog - tab content scrolls inside.
export const DESKTOP_SHEET_HEIGHT = 640;

const sheetStyles = StyleSheet.create((theme) => ({
  monoHint: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    // Shrinks before the label: the mono id usually repeats it.
    flexShrink: 3,
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
  modelRowText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  modelVisibilityCheckbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  modelVisibilityCheckboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  modelVisibilityCheckboxDisabled: {
    opacity: 0.5,
  },
  modelFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  modelTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  modelTooltip: {
    gap: theme.spacing[1],
  },
  modelTooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  modelTooltipMono: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  modelTooltipDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
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
  // Row handed to AdaptiveModalSheet's `footer` - the sheet's own wrapper
  // already supplies padding, the top border, and the row alignment.
  // The next seven entries are duplicated from combined sheet styles in
  // provider-diagnostic-sheet.tsx: both halves of the sheet use them, and this
  // module must not import the Paseo file. Keep the two copies in sync.
  mutedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  // Fixed strip between the sheet header and the scrolling tab content. Row
  // direction keeps the segmented control at its intrinsic width.
  formGroup: {
    gap: theme.spacing[3],
  },
  formLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  sheetFooter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  sheetFooterButton: {
    flex: 1,
  },
}));

const FORM_INPUT_STYLE = [sheetStyles.formInput, isWeb && { outlineStyle: "none" }];

const MODELS_SEARCH_INPUT_STYLE = [sheetStyles.searchInput, isWeb && { outlineStyle: "none" }];

const COMPACT_FOOTER_META_STYLE = [sheetStyles.footerMeta, sheetStyles.compactFooterMeta];
