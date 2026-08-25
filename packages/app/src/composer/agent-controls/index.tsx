import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  Keyboard,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Settings2 } from "@/components/icons/material-icons";
import {
  useComposerToolbarFeatureFit,
  useComposerToolbarStage,
} from "@/composer/input/toolbar-width-context";
import { getAgentFeatureIcon, ThinkingIcon } from "@/agent-controls/icons";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import {
  buildFavoriteModelKey,
  mergeProviderPreferences,
  toggleFavoriteModel,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import {
  AgentModeControl,
  useLiveAgentModeControl,
  type AgentModeControlValue,
} from "@/composer/agent-controls/mode-control";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@otto-code/protocol/agent-types";
import type { AgentProviderDefinition } from "@otto-code/protocol/provider-manifest";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { useAgentControlCommandCenterActions } from "@/command-center/agent-control-registration";
import { compactUp } from "@/styles/theme";
import {
  resolveComposerControlPresentation,
  type ComposerControlPresentation,
} from "@/composer/agent-controls/layout";
import { ComposerControlLayoutProvider } from "@/composer/agent-controls/layout-context";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { COMPOSER_ICON_SIZE } from "@/composer/composer-icon-size";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { CompactModelSheet } from "@/composer/agent-controls/model-sheet";
import {
  toRolePersonality,
  type RolePersonality,
} from "@/provider-selection/role-model-personality";
import { useRunningChatPersonality } from "@/composer/agent-controls/running-personality";

interface AgentControlOption {
  id: string;
  label: string;
}

type AgentControlSelector = "provider" | "mode" | "model" | "thinking" | `feature-${string}`;

// A bound Personality fixed effort at spawn, so hide the effort chip while one
// is selected (mirrors the draft/artifact surfaces); otherwise show it when
// there is a real choice.
function resolvePersonalityAwareThinkingOptions(
  hasBoundProfile: boolean,
  thinkingOptions: AgentControlOption[],
): AgentControlOption[] | undefined {
  if (hasBoundProfile || thinkingOptions.length <= 1) {
    return undefined;
  }
  return thinkingOptions;
}

const EMPTY_AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [];

/**
 * Optional Personality roster + selection wired into the model picker. The
 * draft (new-chat / Chatter) surface passes form-state handlers; the running
 * agent passes RPC-backed ones (agent.personality.set live switch). On daemons
 * without that capability the running surface passes a read-only roster
 * (identity display, no handlers).
 */
interface AgentControlsPersonalityProps {
  /**
   * The unified Personality selection for the model picker, from a producer
   * hook (useFormRolePersonality for the draft surface, toRolePersonality over
   * useRunningChatPersonality for the running agent). Null means a plain model
   * picker with no Personalities section.
   */
  personality?: RolePersonality | null;
}

interface ControlledAgentControlsProps extends AgentControlsPersonalityProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onEditAgentProfiles?: () => void;
  /**
   * A Personality switch RPC is in flight: the model trigger shows a spinner in
   * place of the provider glyph. Callers pair this with `disabled` so the whole
   * controls row locks until the switch completes or times out.
   */
  isPersonalitySwitching?: boolean;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  modeControl?: AgentModeControlValue | null;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
}

export interface DraftAgentControlsProps extends AgentControlsPersonalityProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (provider: AgentProvider, modelId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
}

interface AgentControlsProps {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  onDropdownClose?: () => void;
  isCompactLayout?: boolean;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

function toCommandCenterModes(modeControl: AgentModeControlValue | null) {
  if (!modeControl) return undefined;
  return {
    options: modeControl.modeOptions,
    selectedId: modeControl.selectedModeId,
    select: modeControl.onSelectMode,
  };
}

function getModeProviderDefinitions(modeControl: AgentModeControlValue | null) {
  return modeControl?.providerDefinitions ?? EMPTY_AGENT_PROVIDER_DEFINITIONS;
}

function getFeatureIconColor(
  featureId: string,
  enabled: boolean,
  palette: {
    blue: { 400: string };
    green: { 400: string };
    yellow: { 400: string };
  },
  foregroundMuted: string,
): string {
  if (!enabled) {
    return foregroundMuted;
  }

  switch (getFeatureHighlightColor(featureId)) {
    case "blue":
      return palette.blue[400];
    case "green":
      return palette.green[400];
    case "yellow":
      return palette.yellow[400];
    default:
      return foregroundMuted;
  }
}

type ActiveSheet = "thinking" | "features" | null;

function resolveHasAnyControl({
  providerOptions,
  canSelectModel,
  thinkingOptions,
  features,
  hasMode,
}: {
  providerOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  hasMode: boolean;
}) {
  return (
    Boolean(providerOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length) ||
    hasMode
  );
}

function toComboboxOptions(options: AgentControlOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: `${provider}:${option.id}`,
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function makeBadgePressableStyle(
  baseStyle: StyleProp<ViewStyle>,
  disabledStyle: StyleProp<ViewStyle>,
  disabled: boolean,
  isOpen: boolean,
) {
  return (state: PressableStateCallbackType) => {
    const hovered = "hovered" in state && Boolean(state.hovered);
    return [
      baseStyle,
      hovered && styles.modeBadgeHovered,
      (state.pressed || isOpen) && styles.modeBadgePressed,
      disabled && disabledStyle,
    ];
  };
}

function pickSheetModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectProviderAndModel,
  onSelectProvider,
  onSelectModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  onSelectProvider?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId !== currentProvider) {
    onSelectProvider?.(nextProviderId);
  }
  onSelectModel?.(modelId);
}

function pickDesktopModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectModel,
  onSelectProviderAndModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId === currentProvider) {
    onSelectModel?.(modelId);
  }
}

type AgentControlsSlice = {
  provider: string;
  cwd: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  features: AgentFeature[] | undefined;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
  personalityName: string | null;
  personalityId: string | null;
  personalitySpinner: { glowA: string; glowB: string } | null;
} | null;

function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
    personalityName: currentAgent.personalityName ?? null,
    personalityId: currentAgent.personalityId ?? null,
    personalitySpinner: currentAgent.personalitySpinner ?? null,
  };
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((e) => e.provider === agentProvider) ?? null;
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function buildOpenChangeHandler(
  selector: AgentControlSelector,
  setOpenSelector: (next: AgentControlSelector | null) => void,
  onDropdownClose?: () => void,
) {
  return (nextOpen: boolean) => {
    setOpenSelector(nextOpen ? selector : null);
    if (!nextOpen) {
      onDropdownClose?.();
    }
  };
}

function ControlledAgentControls({
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  favoriteKeys,
  onToggleFavoriteModel,
  onEditAgentProfiles,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  modeControl,
  modelSelectorServerId = null,
  isCompactLayout,
  personality = null,
  isPersonalitySwitching = false,
}: ControlledAgentControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<AgentControlSelector | null>(null);

  const providerAnchorRef = useRef<View>(null);
  const _modelAnchorRef = useRef<View>(null);
  const thinkingAnchorRef = useRef<View>(null);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectModel = Boolean(onSelectModel);
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );

  const displayProvider = findOptionLabel(
    providerOptions,
    selectedProviderId,
    t("agentControls.provider.fallback"),
  );
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("agentControls.thinking.unknown"),
  );

  const hasAnyControl = resolveHasAnyControl({
    providerOptions,
    canSelectModel,
    thinkingOptions,
    features,
    hasMode: modeControl !== null && modeControl !== undefined,
  });
  // The composer row owns responsive behavior: it is the only place that can
  // compare the controls' intrinsic width against the space available, so the
  // stage arrives from above and no control ever collapses itself. Labels drop
  // one control at a time; uniform scaling only starts once they are all gone.
  const toolbarStage = useComposerToolbarStage();
  const presentation = useMemo(
    () => resolveComposerControlPresentation(toolbarStage),
    [toolbarStage],
  );
  const layoutContextValue = useMemo(
    () => ({
      presentation,
    }),
    [presentation],
  );

  const modelDisabled = disabled;

  const comboboxProviderOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(providerOptions),
    [providerOptions],
  );
  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(formattedThinkingOptions),
    [formattedThinkingOptions],
  );

  const renderThinkingOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ThinkingComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        iconColor={theme.colors.foreground}
      />
    ),
    [theme.colors.foreground],
  );

  const handleOpenChange = useCallback(
    (selector: AgentControlSelector) =>
      buildOpenChangeHandler(selector, setOpenSelector, onDropdownClose),
    [onDropdownClose],
  );
  const handleSheetOpenChange = useCallback(
    (selector: AgentControlSelector) => (nextOpen: boolean) => {
      setOpenSelector(nextOpen ? selector : null);
    },
    [],
  );

  const handleProviderPress = useCallback(() => {
    handleOpenChange("provider")(openSelector !== "provider");
  }, [handleOpenChange, openSelector]);

  const handleThinkingPress = useCallback(() => {
    handleOpenChange("thinking")(openSelector !== "thinking");
  }, [handleOpenChange, openSelector]);

  const handleProviderOpenChange = useMemo(() => handleOpenChange("provider"), [handleOpenChange]);
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );

  const handleDesktopModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickDesktopModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectModel,
        onSelectProviderAndModel,
      });
    },
    [onSelectModel, onSelectProviderAndModel, provider],
  );

  const providerPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectProvider,
        openSelector === "provider",
      ),
    [canSelectProvider, disabled, openSelector],
  );

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
    if (!isCompact) onDropdownClose?.();
  }, [isCompact, onDropdownClose]);

  const handleSelectThinkingAndClose = useCallback(
    (thinkingOptionId: string) => {
      onSelectThinkingOption?.(thinkingOptionId);
      setActiveSheet(null);
    },
    [onSelectThinkingOption],
  );

  const handleSheetModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickSheetModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectProvider,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProvider, onSelectProviderAndModel, provider],
  );

  if (!hasAnyControl) {
    return null;
  }

  return (
    <ComposerControlLayoutProvider value={layoutContextValue}>
      <View style={styles.container}>
        {!isCompact ? (
          <DesktopAgentControlsContent
            provider={provider}
            providerOptions={providerOptions}
            selectedProviderId={selectedProviderId}
            modelOptions={modelOptions}
            selectedModelId={selectedModelId}
            favoriteKeys={favoriteKeys}
            onToggleFavoriteModel={onToggleFavoriteModel}
            thinkingOptions={formattedThinkingOptions}
            selectedThinkingOptionId={selectedThinkingOptionId}
            features={features}
            onSetFeature={onSetFeature}
            onEditAgentProfiles={onEditAgentProfiles}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            personality={personality}
            isPersonalitySwitching={isPersonalitySwitching}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectProvider={canSelectProvider}
            canSelectModel={canSelectModel}
            canSelectThinking={canSelectThinking}
            modelSelectorProviders={effectiveModelSelectorProviders}
            modelDisabled={modelDisabled}
            comboboxProviderOptions={comboboxProviderOptions}
            comboboxThinkingOptions={comboboxThinkingOptions}
            displayProvider={displayProvider}
            displayThinking={displayThinking}
            openSelector={openSelector}
            providerAnchorRef={providerAnchorRef}
            thinkingAnchorRef={thinkingAnchorRef}
            providerPressableStyle={providerPressableStyle}
            handleProviderPress={handleProviderPress}
            handleThinkingPress={handleThinkingPress}
            handleProviderSelect={handleProviderSelect}
            handleThinkingSelect={handleThinkingSelect}
            handleDesktopModelSelect={handleDesktopModelSelect}
            handleProviderOpenChange={handleProviderOpenChange}
            handleThinkingOpenChange={handleThinkingOpenChange}
            handleOpenChange={handleOpenChange}
            handleNestedOpenChange={handleSheetOpenChange}
            renderThinkingOption={renderThinkingOption}
            modeControl={modeControl}
            presentation={presentation}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            modelSelectorServerId={modelSelectorServerId}
          />
        ) : (
          <SheetAgentControlsContent
            provider={provider}
            selectedModelId={selectedModelId}
            selectedThinkingOptionId={selectedThinkingOptionId}
            features={features}
            onSetFeature={onSetFeature}
            onEditAgentProfiles={onEditAgentProfiles}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            personality={personality}
            isPersonalitySwitching={isPersonalitySwitching}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectModel={canSelectModel}
            canSelectThinking={canSelectThinking}
            modelSelectorProviders={effectiveModelSelectorProviders}
            modelDisabled={modelDisabled}
            comboboxThinkingOptions={comboboxThinkingOptions}
            openSelector={openSelector}
            displayThinking={displayThinking}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            handleSheetModelSelect={handleSheetModelSelect}
            handleSelectThinkingAndClose={handleSelectThinkingAndClose}
            handleOpenChange={handleSheetOpenChange}
            renderThinkingOption={renderThinkingOption}
            modeControl={modeControl}
            modelSelectorServerId={modelSelectorServerId}
          />
        )}
      </View>
    </ComposerControlLayoutProvider>
  );
}

interface DesktopAgentControlsContentProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onEditAgentProfiles?: () => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  personality: RolePersonality | null;
  isPersonalitySwitching: boolean;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxProviderOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  displayProvider: string;
  displayThinking: string;
  openSelector: AgentControlSelector | null;
  providerAnchorRef: RefObject<View | null>;
  thinkingAnchorRef: RefObject<View | null>;
  providerPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleProviderPress: () => void;
  handleThinkingPress: () => void;
  handleProviderSelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  handleProviderOpenChange: (open: boolean) => void;
  handleThinkingOpenChange: (open: boolean) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  handleNestedOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  modeControl?: AgentModeControlValue | null;
  presentation: ComposerControlPresentation;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  modelSelectorServerId: string | null;
}

const DESKTOP_SEARCH_THRESHOLD = 6;

function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const { t } = useTranslation();
  const {
    provider,
    providerOptions,
    selectedProviderId,
    selectedModelId,
    favoriteKeys,
    onToggleFavoriteModel,
    thinkingOptions,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onEditAgentProfiles,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    personality,
    isPersonalitySwitching,
    disabled,
    isModelLoading,
    canSelectProvider,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxProviderOptions,
    comboboxThinkingOptions,
    displayProvider,
    displayThinking,
    openSelector,
    providerAnchorRef,
    thinkingAnchorRef,
    providerPressableStyle,
    handleProviderPress,
    handleThinkingPress,
    handleProviderSelect,
    handleThinkingSelect,
    handleDesktopModelSelect,
    handleProviderOpenChange,
    handleThinkingOpenChange,
    handleOpenChange,
    renderThinkingOption,
    modeControl,
    presentation,
    modelSelectorServerId,
  } = props;
  return (
    <>
      {providerOptions && providerOptions.length > 0 ? (
        <>
          <ComboboxTrigger
            ref={providerAnchorRef}
            collapsable={false}
            disabled={disabled || !canSelectProvider}
            onPress={handleProviderPress}
            style={providerPressableStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.provider.select")}
            testID="agent-provider-selector"
          >
            <Text style={styles.modeBadgeText}>{displayProvider}</Text>
          </ComboboxTrigger>
          <Combobox
            options={comboboxProviderOptions}
            value={selectedProviderId ?? ""}
            onSelect={handleProviderSelect}
            searchable={comboboxProviderOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "provider"}
            onOpenChange={handleProviderOpenChange}
            anchorRef={providerAnchorRef}
            desktopPlacement="top-start"
          />
        </>
      ) : null}

      {canSelectModel ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <View style={styles.modelControl}>
              <CombinedModelSelector
                providers={modelSelectorProviders}
                favoriteKeys={favoriteKeys}
                onToggleFavorite={onToggleFavoriteModel}
                selectedProvider={provider}
                selectedModel={selectedModelId ?? ""}
                onSelect={handleDesktopModelSelect}
                personalities={personality?.personalities}
                profileGroups={personality?.profileGroups}
                selectedProfileId={personality?.selectedProfileId ?? null}
                onSelectProfile={personality?.onSelectProfile}
                onClearProfile={personality?.onClearProfile}
                onSelectModelOverProfile={personality?.onSelectModelOverProfile}
                triggerLoading={isPersonalitySwitching}
                onEditProfiles={onEditAgentProfiles}
                isLoading={isModelLoading}
                disabled={modelDisabled}
                onOpen={onModelSelectorOpen}
                onClose={onDropdownClose}
                onRetryProvider={onRetryModelProvider}
                isRetryingProvider={isRetryingModelProvider}
                serverId={modelSelectorServerId}
                desktopPlacement="top-start"
                desktopMinWidth={360}
                iconOnly={!presentation.showModelLabel}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t(getAgentControlHintKey("model"))}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {thinkingOptions && thinkingOptions.length > 0 ? (
        <>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild triggerRefProp="ref">
              <AgentControlTrigger
                ref={thinkingAnchorRef}
                icon={ThinkingIcon}
                surface="toolbar"
                label={t("agentControls.thinking.title")}
                value={displayThinking}
                showToolbarLabel={presentation.showThinkingLabel}
                showCaret={presentation.showThinkingLabel}
                open={openSelector === "thinking"}
                disabled={disabled || !canSelectThinking}
                onPress={handleThinkingPress}
                accessibilityLabel={t("agentControls.thinking.selectWithValue", {
                  value: displayThinking,
                })}
                testID="agent-thinking-selector"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t(getAgentControlHintKey("thinking"))}</Text>
            </TooltipContent>
          </Tooltip>
          <Combobox
            options={comboboxThinkingOptions}
            value={selectedThinkingOptionId ?? ""}
            onSelect={handleThinkingSelect}
            searchable={comboboxThinkingOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "thinking"}
            onOpenChange={handleThinkingOpenChange}
            anchorRef={thinkingAnchorRef}
            desktopPlacement="top-start"
            desktopMinWidth={200}
            renderOption={renderThinkingOption}
          />
        </>
      ) : null}

      {modeControl ? <AgentModeControl {...modeControl} onClose={onDropdownClose} /> : null}

      {features?.map((feature) => (
        <DesktopFeatureItem
          key={`feature-${feature.id}`}
          feature={feature}
          disabled={disabled}
          showLabel={presentation.showFeatureLabels}
          openSelector={openSelector}
          handleOpenChange={handleOpenChange}
          onSetFeature={onSetFeature}
          onActionComplete={onDropdownClose}
        />
      ))}
    </>
  );
}

interface SheetAgentControlsContentProps {
  provider: string;
  selectedModelId?: string;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onEditAgentProfiles?: () => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  personality: RolePersonality | null;
  isPersonalitySwitching: boolean;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxThinkingOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  displayThinking: string;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  modeControl?: AgentModeControlValue | null;
  modelSelectorServerId: string | null;
}

function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const { t } = useTranslation();
  const {
    provider,
    selectedModelId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onEditAgentProfiles,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    personality,
    isPersonalitySwitching,
    disabled,
    isModelLoading,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxThinkingOptions,
    openSelector,
    displayThinking,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectThinkingAndClose,
    handleOpenChange,
    renderThinkingOption,
    modeControl,
    modelSelectorServerId,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);

  const hasThinking = comboboxThinkingOptions.length > 0;
  const canFitFeatures = useComposerToolbarFeatureFit();
  const showFeatures = Boolean(features && features.length > 0) && canFitFeatures;
  const featuresSheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.features.title") }),
    [t],
  );

  const handleOpenThinking = useCallback(() => handleOpenSheet("thinking"), [handleOpenSheet]);
  const handleOpenFeatures = useCallback(() => handleOpenSheet("features"), [handleOpenSheet]);
  const handleThinkingSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("thinking");
      } else {
        handleCloseSheet();
      }
    },
    [handleCloseSheet, handleOpenSheet],
  );

  useEffect(() => {
    if (!showFeatures && activeSheet === "features") {
      handleCloseSheet();
    }
  }, [activeSheet, handleCloseSheet, showFeatures]);

  return (
    <View style={styles.container} testID="agent-controls-compact-toolbar">
      {canSelectModel ? (
        <CompactModelSheet
          providers={modelSelectorProviders}
          selectedProvider={provider}
          selectedModel={selectedModelId ?? ""}
          onSelect={handleSheetModelSelect}
          personality={personality}
          isSwitchingPersonality={isPersonalitySwitching}
          onEditProfiles={onEditAgentProfiles}
          isLoading={isModelLoading}
          disabled={modelDisabled}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
          onRetryProvider={onRetryModelProvider}
          isRetryingProvider={isRetryingModelProvider}
          serverId={modelSelectorServerId}
          iconOnly
        />
      ) : null}

      {hasThinking ? (
        <>
          <AgentControlTrigger
            ref={thinkingAnchorRef}
            icon={ThinkingIcon}
            surface="toolbar"
            label={t("agentControls.thinking.title")}
            value={displayThinking}
            showToolbarLabel={false}
            open={activeSheet === "thinking"}
            onPress={handleOpenThinking}
            disabled={disabled || !canSelectThinking}
            accessibilityLabel={t("agentControls.thinking.selectWithValue", {
              value: displayThinking,
            })}
            testID="agent-controls-thinking"
          />
          <Combobox
            options={comboboxThinkingOptions}
            value={selectedThinkingOptionId ?? ""}
            onSelect={handleSelectThinkingAndClose}
            searchable={false}
            title={t("agentControls.thinking.title")}
            open={activeSheet === "thinking"}
            onOpenChange={handleThinkingSheetOpenChange}
            anchorRef={thinkingAnchorRef}
            renderOption={renderThinkingOption}
            presentation="push"
          />
        </>
      ) : null}

      {modeControl ? (
        <AgentModeControl {...modeControl} iconOnly onClose={onDropdownClose} />
      ) : null}

      {showFeatures ? (
        <Pressable
          onPress={handleOpenFeatures}
          disabled={disabled}
          style={styles.modeIconBadge}
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.features.open")}
          testID="agent-controls-features"
        >
          <ComposerToolbarGlyph>
            <Settings2 size={COMPOSER_ICON_SIZE} color={styles.featuresIcon.color} />
          </ComposerToolbarGlyph>
        </Pressable>
      ) : null}

      <AdaptiveModalSheet
        header={featuresSheetHeader}
        visible={showFeatures && activeSheet === "features"}
        onClose={handleCloseSheet}
        testID="agent-features-sheet"
      >
        {(features ?? []).map((feature) => (
          <SheetFeatureItem
            key={`feature-${feature.id}`}
            feature={feature}
            disabled={disabled}
            openSelector={openSelector}
            handleOpenChange={handleOpenChange}
            onSetFeature={onSetFeature}
          />
        ))}
      </AdaptiveModalSheet>
    </View>
  );
}

function DesktopFeatureItem({
  feature,
  disabled,
  showLabel,
  openSelector,
  handleOpenChange,
  onSetFeature,
  onActionComplete,
}: {
  feature: AgentFeature;
  disabled: boolean;
  /** Toggle features are always icon-only; this collapses the select chips. */
  showLabel: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
  onActionComplete?: () => void;
}) {
  const { theme } = useUnistyles();
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;
  const featureAnchorRef = useRef<View>(null);

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );
  const handleSelectPress = useCallback(
    () => handleFeatureOpenChange(openSelector !== featureSelector),
    [featureSelector, handleFeatureOpenChange, openSelector],
  );

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
      onActionComplete?.();
    }
  }, [feature, onActionComplete, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      feature.type === "select"
        ? feature.options.map((option) => ({ id: option.id, label: option.label }))
        : [],
    [feature],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getAgentFeatureIcon(feature.icon);
    return (
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            icon={FeatureIcon}
            iconColor={getFeatureIconColor(
              feature.id,
              feature.value,
              theme.colors.palette,
              theme.colors.foregroundMuted,
            )}
            surface="toolbar"
            label={feature.label}
            showToolbarLabel={false}
            disabled={disabled}
            onPress={handleTogglePress}
            accessibilityLabel={getFeatureTooltip(feature)}
            testID={`agent-feature-${feature.id}`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getAgentFeatureIcon(feature.icon);
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <AgentControlTrigger
              ref={featureAnchorRef}
              icon={FeatureIcon}
              surface="toolbar"
              label={feature.label}
              value={selectedOption?.label ?? feature.label}
              showToolbarLabel={showLabel}
              showCaret={showLabel}
              open={openSelector === featureSelector}
              disabled={disabled}
              onPress={handleSelectPress}
              accessibilityLabel={getFeatureTooltip(feature)}
              testID={`agent-feature-${feature.id}`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
          </TooltipContent>
        </Tooltip>
        <Combobox
          options={comboboxOptions}
          value={String(feature.value)}
          onSelect={handleSelectOption}
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
          anchorRef={featureAnchorRef}
          desktopPlacement="top-start"
        />
      </>
    );
  }

  return null;
}

function SheetFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;
  const featureAnchorRef = useRef<View>(null);

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );
  const handleSelectPress = useCallback(
    () => handleFeatureOpenChange(openSelector !== featureSelector),
    [featureSelector, handleFeatureOpenChange, openSelector],
  );
  const sheetHeader = useMemo<SheetHeader>(() => ({ title: feature.label }), [feature.label]);

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      feature.type === "select"
        ? feature.options.map((option) => ({ id: option.id, label: option.label }))
        : [],
    [feature],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getAgentFeatureIcon(feature.icon);
    return (
      <AgentControlTrigger
        icon={FeatureIcon}
        iconColor={getFeatureIconColor(
          feature.id,
          feature.value,
          theme.colors.palette,
          theme.colors.foregroundMuted,
        )}
        surface="sheet"
        label={feature.label}
        value={feature.value ? t("agentControls.features.on") : t("agentControls.features.off")}
        disabled={disabled}
        onPress={handleTogglePress}
        accessibilityLabel={getFeatureTooltip(feature)}
        testID={`agent-feature-${feature.id}`}
      />
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getAgentFeatureIcon(feature.icon);
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <>
        <AgentControlTrigger
          ref={featureAnchorRef}
          icon={FeatureIcon}
          surface="sheet"
          label={feature.label}
          value={selectedOption?.label ?? feature.label}
          open={openSelector === featureSelector}
          disabled={disabled}
          onPress={handleSelectPress}
          accessibilityLabel={getFeatureTooltip(feature)}
          testID={`agent-feature-${feature.id}`}
        />
        <Combobox
          options={comboboxOptions}
          value={String(feature.value)}
          onSelect={handleSelectOption}
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
          anchorRef={featureAnchorRef}
          presentation="push"
          header={sheetHeader}
        />
      </>
    );
  }

  return null;
}

function ThinkingComboboxOption({
  option,
  selected,
  active,
  onPress,
  iconColor,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  iconColor: string;
}) {
  const leadingSlot = useMemo(() => <ThinkingIcon size="md" color={iconColor} />, [iconColor]);
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export const AgentControls = memo(function AgentControls({
  agentId,
  serverId,
  isPaneFocused,
  onDropdownClose,
  isCompactLayout,
}: AgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();
  const modeControl = useLiveAgentModeControl(serverId, agentId);
  const commandCenterModes = toCommandCenterModes(modeControl);
  const modeProviderDefinitions = getModeProviderDefinitions(modeControl);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });

  const snapshotSelectedEntry = useMemo(
    () => resolveSnapshotSelectedEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );

  const models = filterSelectableModels(snapshotSelectedEntry?.models ?? null);
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";

  const agentProviderDefinitions = useMemo(
    () => buildAgentProviderDefinitions(agent?.provider, snapshotEntries),
    [agent?.provider, snapshotEntries],
  );

  const agentProviderModels = useMemo(
    () => buildAgentProviderModels(agent?.provider, models),
    [agent?.provider, models],
  );
  const agentModelSelectorProviders = useMemo(() => {
    if (snapshotSelectedEntry) {
      return buildSelectableProviderSelectorProviders([snapshotSelectedEntry]);
    }
    return buildProviderSelectorProviders({
      providerDefinitions: agentProviderDefinitions,
      modelsByProvider: agentProviderModels,
    });
  }, [agentProviderDefinitions, agentProviderModels, snapshotSelectedEntry]);

  const modelSelection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modelOptions = useMemo<AgentControlOption[]>(() => {
    return (models ?? []).map((model) => ({ id: model.id, label: model.label }));
  }, [models]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const thinkingOptions = useMemo<AgentControlOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: formatThinkingOptionLabel(option),
    }));
  }, [modelSelection.thinkingOptions]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      try {
        const notice = await client.setAgentModel(agentId, modelId);
        showProviderNoticeToast(toast, notice);
        await updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: { model: modelId },
          }),
        );
      } catch (error) {
        console.warn("[AgentControls] setAgentModel or persist preference failed", error);
        toast.error(toErrorMessage(error));
      }
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );
  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[AgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );
  const handleSelectCommandCenterModel = useCallback(
    (_provider: AgentProvider, modelId: string) => handleSelectModel(modelId),
    [handleSelectModel],
  );

  // Selectable same-family Personalities for the model picker. Picking one goes
  // through the agent.personality.set RPC - the daemon applies prompt + identity
  // + model/mode/effort atomically and restarts the provider query - behind a
  // suppressible warning dialog. While the RPC is in flight the whole controls
  // row locks and the model trigger spins (30s cap, then it unlocks for retry).
  const chatPersonality = toRolePersonality(
    useRunningChatPersonality({
      agentId,
      serverId,
      agent,
      entries: snapshotEntries,
      client,
      toast,
    }),
  );
  const isSwitchingPersonality = chatPersonality.isSwitching;
  const thinkingOptionsForControls = resolvePersonalityAwareThinkingOptions(
    chatPersonality.hasBoundProfile,
    thinkingOptions,
  );

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client
        .setAgentThinkingOption(agentId, thinkingOptionId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentControls] setAgentThinkingOption failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentControls] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  useAgentControlCommandCenterActions({
    sourceId: `agent:${serverId}:${agentId}`,
    enabled: isPaneFocused && Boolean(client),
    controls: {
      serverId,
      ownerKey: agentId,
      provider: agentProvider,
      providerDefinitions: modeProviderDefinitions,
      models: {
        providers: agentModelSelectorProviders,
        selectedProvider: agentProvider,
        selectedModelId: activeModelId,
        select: handleSelectCommandCenterModel,
      },
      thinking: {
        options: modelSelection.thinkingOptions,
        selectedId: modelSelection.selectedThinkingId,
        select: handleSelectThinkingOption,
      },
      modes: commandCenterModes,
      features: {
        list: agent?.features,
        set: handleSetFeature,
      },
    },
  });

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale(agentProvider);
  }, [agentProvider, refetchSnapshotIfStale]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]);
    },
    [refreshSnapshot],
  );

  if (!agent) {
    return null;
  }

  return (
    <ControlledAgentControls
      provider={agent.provider}
      modelSelectorProviders={agentModelSelectorProviders}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      onSelectModel={handleSelectModel}
      personality={chatPersonality}
      isPersonalitySwitching={isSwitchingPersonality}
      thinkingOptions={thinkingOptionsForControls}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={snapshotIsLoading || selectedProviderIsLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onRetryModelProvider={handleRetryModelProvider}
      isRetryingModelProvider={snapshotIsRefreshing}
      onDropdownClose={onDropdownClose}
      disabled={!client || isSwitchingPersonality}
      modeControl={modeControl}
      modelSelectorServerId={serverId}
      isCompactLayout={isCompactLayout}
    />
  );
});

export function DraftAgentControls({
  providerDefinitions,
  selectedProvider,
  modeOptions,
  selectedMode,
  onSelectMode,
  models,
  selectedModel,
  onSelectModel,
  isModelLoading: _isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  disabled = false,
  modelSelectorServerId = null,
  isCompactLayout,
  personality = null,
}: DraftAgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );
  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[DraftAgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );
  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions);
  }, [thinkingOptions]);

  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  const modeControl = useMemo<AgentModeControlValue | null>(
    () =>
      selectedProvider && modeOptions.length > 0
        ? {
            provider: selectedProvider,
            providerDefinitions,
            modeOptions,
            selectedModeId: selectedMode,
            onSelectMode,
            disabled,
          }
        : null,
    [selectedProvider, providerDefinitions, modeOptions, selectedMode, onSelectMode, disabled],
  );

  return (
    <ControlledAgentControls
      provider={selectedProvider ?? ""}
      modelSelectorProviders={modelSelectorProviders}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      modelOptions={modelOptions}
      selectedModelId={selectedModel}
      onSelectModel={onSelectModel}
      onSelectProviderAndModel={onSelectProviderAndModel}
      isModelLoading={isAllModelsLoading}
      personality={personality}
      thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
      selectedThinkingOptionId={effectiveSelectedThinkingOption}
      onSelectThinkingOption={onSelectThinkingOption}
      features={features}
      onSetFeature={onSetFeature}
      onDropdownClose={onDropdownClose}
      onModelSelectorOpen={onModelSelectorOpen}
      onRetryModelProvider={onRetryModelProvider}
      isRetryingModelProvider={isRetryingModelProvider}
      disabled={disabled}
      modeControl={modeControl}
      modelSelectorServerId={modelSelectorServerId}
      isCompactLayout={isCompactLayout}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modeBadge: {
    height: compactUp(28),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.full,
  },
  modelControl: {
    minWidth: 0,
    flexShrink: 1,
  },
  toolbarCaret: {
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  modeIconBadge: {
    width: compactUp(28),
    height: compactUp(28),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
    flexShrink: 0,
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.full,
  },
  modeBadgeHovered: {
    backgroundColor: theme.colors.surface2,
  },
  modeBadgePressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabledBadge: {
    opacity: 0.5,
  },
  modeBadgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  featuresIcon: {
    color: theme.colors.foregroundMuted,
  },
  combinedSheetControls: {
    gap: theme.spacing[1],
  },
}));
