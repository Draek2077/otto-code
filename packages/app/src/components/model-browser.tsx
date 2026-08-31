import { createContext, useCallback, useContext, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Plus,
  Search,
  Settings,
} from "@/components/icons/material-icons";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { RolePersonality } from "@/provider-selection/role-model-personality";
import {
  PersonalitiesSection,
  type SelectorProfile,
} from "@/components/model-selector/selector-content";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { IconSizeProp } from "@/components/icons/icon-size";
import { getProviderIcon } from "@/components/provider-icons";
import { BrainModelFamilyIcon } from "@/components/brain/brain-model-family-icon";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import {
  buildProviderQualifiedDescription,
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  presentProviderModelSelectionError,
  resolveSelectedModelLabel,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useCurrentOverlayLayer } from "@/lib/overlay-root";
import type { Theme } from "@/styles/theme";
import {
  resolveInitialModelBrowserView,
  resolveModelBrowserAllView,
  type ModelBrowserView,
} from "@/components/model-browser-view";

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;

const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedPlus = withUnistyles(Plus);
const ThemedSearch = withUnistyles(Search);
const ThemedSettings = withUnistyles(Settings);
const ThemedBrainModelFamilyIcon = withUnistyles(BrainModelFamilyIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function ProviderSettingsAction({
  accessibilityLabel,
  provider,
  serverId,
}: {
  accessibilityLabel: string;
  provider: string;
  serverId: string | null;
}) {
  const overlayParentLayer = useCurrentOverlayLayer();
  const handlePress = useCallback(() => {
    if (!serverId) return;
    useProviderSettingsStore.getState().open({ serverId, provider, overlayParentLayer });
  }, [overlayParentLayer, provider, serverId]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={!serverId}
      hitSlop={8}
      style={iconButtonStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`selector-header-settings-${provider}`}
    >
      <HeaderSettingsIcon disabled={!serverId} />
    </Pressable>
  );
}

const IndependentScrollGestureContext = createContext<ReturnType<typeof Gesture.Native> | null>(
  null,
);

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const headerSettingsMapping = (disabled: boolean) => (theme: Theme) => ({
  color: disabled ? theme.colors.border : theme.colors.foregroundMuted,
});

interface ModelBrowserInput {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  isLoading: boolean;
  /** Pinned above the provider list on the root view. `null` hides the section. */
  personality?: RolePersonality | null;
  serverId?: string | null;
}

export interface ModelBrowserState {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  personality: RolePersonality | null;
  view: ModelBrowserView;
  searchQuery: string;
  isSearchFocused: boolean;
  onSearchFocusChange: (focused: boolean) => void;
  header: SheetHeader;
  selectedModelLabel: string;
  triggerLabel: string;
  desktopFixedHeight: number | undefined;
  isProviderView: boolean;
  prepareToOpen: () => void;
  reset: () => void;
  drillDown: (providerId: string, providerLabel: string) => void;
}

interface ModelBrowserProps {
  state: ModelBrowserState;
  onSelect: (provider: string, modelId: string) => void;
  /** Picking a Personality resolves the pick and dismisses, exactly like a model row. */
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
  onEditProfiles?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  scrolling?: "sheet" | "independent";
}

interface ModelBrowserContentProps extends Omit<ModelBrowserProps, "state" | "scrolling"> {
  view: ModelBrowserView;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  searchQuery: string;
  isSearchFocused: boolean;
  personality: RolePersonality | null;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  scrolling: "sheet" | "independent";
}

type ProviderGlyphTone = "muted" | "foreground";

export function ModelProviderGlyph({
  provider,
  size,
  tone = "muted",
}: {
  provider: string;
  size: IconSizeProp;
  tone?: ProviderGlyphTone;
}) {
  const Icon = getProviderIcon(provider);
  const color =
    tone === "foreground" ? styles.providerIconForeground.color : styles.providerIconMuted.color;
  return <Icon size={size} color={color} />;
}

function HeaderSettingsIcon({ disabled }: { disabled: boolean }) {
  const uniProps = useMemo(() => headerSettingsMapping(disabled), [disabled]);
  return <ThemedSettings size="sm" uniProps={uniProps} />;
}

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.rowIconButton,
    Boolean(hovered) && styles.rowIconButtonHovered,
    pressed && styles.rowIconButtonPressed,
  ];
}

function countModelsInView(view: ModelBrowserView, providers: ProviderSelectorProvider[]): number {
  if (view.kind === "all") {
    return getAllProviderModelRows(providers).length;
  }
  const provider = providers.find((entry) => entry.id === view.providerId);
  return provider?.modelSelection.kind === "models" ? getProviderModelRows(provider).length : 0;
}

function resolveDesktopFixedHeight(
  view: ModelBrowserView,
  providers: ProviderSelectorProvider[],
): number {
  const modelCount = countModelsInView(view, providers);
  return Math.min(
    Math.max(
      DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
      DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + modelCount * DESKTOP_MODEL_ROW_HEIGHT,
    ),
    DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
  );
}

export function useModelBrowser({
  providers,
  selectedProvider,
  selectedModel,
  isLoading,
  personality = null,
  serverId = null,
}: ModelBrowserInput): ModelBrowserState {
  const { t } = useTranslation();
  const [view, setView] = useState<ModelBrowserView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  // Focusing the field opens the searchable list straight away, so an empty
  // query still means "I am looking for a model" rather than "browse".
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);
  const hasProfiles = (personality?.personalities?.length ?? 0) > 0;

  const initialView = useMemo(
    () =>
      resolveInitialModelBrowserView({
        providers,
        selectedProvider,
        selectedModel,
        hasProfiles,
      }),
    [hasProfiles, providers, selectedModel, selectedProvider],
  );

  const prepareToOpen = useCallback(() => {
    setView(initialView);
  }, [initialView]);

  const reset = useCallback(() => {
    setSearchQuery("");
    bumpSearchResetKey();
  }, []);

  const handleBackToAll = useCallback(() => {
    setView({ kind: "all" });
    reset();
  }, [reset]);

  const drillDown = useCallback(
    (providerId: string, providerLabel: string) => {
      setView({ kind: "provider", providerId, providerLabel });
      reset();
    },
    [reset],
  );

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSearchFocusChange = useCallback((focused: boolean) => {
    setIsSearchFocused(focused);
  }, []);

  const singleProviderView = providers.length === 1;
  const header = useMemo<SheetHeader>(() => {
    if (view.kind === "all") {
      return {
        title: t("modelSelector.title"),
        search: {
          onChange: handleSearchQueryChange,
          resetKey: `all:${searchResetKey}`,
          placeholder: t("modelSelector.searchAllPlaceholder"),
          autoFocus: isWeb,
          testID: "model-search-all-input",
        },
      };
    }
    return {
      title: view.providerLabel,
      leading: <ModelProviderGlyph provider={view.providerId} size="md" tone="foreground" />,
      back: singleProviderView ? undefined : { onPress: handleBackToAll },
      actions: (
        <View style={styles.headerActionRow}>
          <ProviderSettingsAction
            serverId={serverId}
            provider={view.providerId}
            accessibilityLabel={t("modelSelector.openProviderSettings", {
              provider: view.providerLabel,
            })}
          />
        </View>
      ),
      search: {
        onChange: handleSearchQueryChange,
        resetKey: `${view.providerId}:${searchResetKey}`,
        placeholder: t("modelSelector.searchPlaceholder"),
        autoFocus: isWeb,
        testID: "model-search-input",
      },
    };
  }, [
    handleBackToAll,
    handleSearchQueryChange,
    searchResetKey,
    serverId,
    singleProviderView,
    t,
    view,
  ]);

  const selectedModelLabel = useMemo(
    () =>
      resolveSelectedModelLabel({
        providers,
        selectedProvider,
        selectedModel,
        isLoading,
      }),
    [isLoading, providers, selectedModel, selectedProvider],
  );

  const triggerLabel = useMemo(() => {
    const isPlaceholder =
      selectedModelLabel === t("modelSelector.loading") ||
      selectedModelLabel === t("modelSelector.selectModel");
    return isPlaceholder ? selectedModelLabel : buildSelectedTriggerLabel(selectedModelLabel);
  }, [selectedModelLabel, t]);

  const desktopFixedHeight = useMemo(
    () => resolveDesktopFixedHeight(view, providers),
    [providers, view],
  );

  return {
    providers,
    selectedProvider,
    selectedModel,
    personality,
    view,
    searchQuery,
    isSearchFocused,
    onSearchFocusChange: handleSearchFocusChange,
    header,
    selectedModelLabel,
    triggerLabel,
    desktopFixedHeight,
    isProviderView: view.kind === "provider",
    prepareToOpen,
    reset,
    drillDown,
  };
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

interface ModelBrowserPressableProps {
  children: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType & { hovered?: boolean }) => StyleProp<ViewStyle>);
  onPress: () => void;
  hitSlop?: number;
  accessibilityLabel?: string;
  /** Only rows that can express selection pass this; the rest stay unannotated. */
  accessibilitySelected?: boolean;
  testID?: string;
}

function ModelBrowserPressable({
  children,
  style,
  onPress,
  hitSlop,
  accessibilityLabel,
  accessibilitySelected,
  testID,
}: ModelBrowserPressableProps) {
  const independentScrollGesture = useContext(IndependentScrollGestureContext);
  const [pressed, setPressed] = useState(false);
  // Android's scroll handler must keep the pointer stream until release so a
  // fling survives leaving the short viewport. A simultaneous Tap keeps rows
  // interactive, while maxDistance makes a real scroll fail instead of select.
  const tapGesture = useMemo(() => {
    const gesture = Gesture.Tap()
      .maxDistance(8)
      .shouldCancelWhenOutside(true)
      .runOnJS(true)
      .onBegin(() => setPressed(true))
      .onEnd((_event, success) => {
        if (success) onPress();
      })
      .onFinalize(() => setPressed(false));
    if (hitSlop !== undefined) gesture.hitSlop(hitSlop);
    if (independentScrollGesture) {
      gesture.simultaneousWithExternalGesture(independentScrollGesture);
    }
    return gesture;
  }, [hitSlop, independentScrollGesture, onPress]);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "activate") onPress();
    },
    [onPress],
  );
  const accessibilityState = useMemo(
    () => (accessibilitySelected === undefined ? undefined : { selected: accessibilitySelected }),
    [accessibilitySelected],
  );

  if (!independentScrollGesture) {
    return (
      <Pressable
        onPress={handlePress}
        hitSlop={hitSlop}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        aria-selected={accessibilitySelected}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }

  const state = { pressed };
  const resolvedStyle = typeof style === "function" ? style(state) : style;
  const resolvedChildren = typeof children === "function" ? children(state) : children;
  return (
    <GestureDetector gesture={tapGesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        aria-selected={accessibilitySelected}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={handleAccessibilityAction}
        style={resolvedStyle}
        testID={testID}
      >
        {resolvedChildren}
      </View>
    </GestureDetector>
  );
}

type ModelBrowserRowTone = "default" | "elevated" | "drillDown";

function ModelBrowserRow({
  label,
  description,
  leadingSlot,
  trailingSlot,
  trailingAction,
  selected = false,
  selectionIndicator = false,
  tone = "default",
  labelMuted = false,
  spacing = "model",
  onPress,
  testID,
}: {
  label: string;
  description?: string;
  leadingSlot: React.ReactNode;
  trailingSlot?: React.ReactNode;
  trailingAction?: React.ReactNode;
  selected?: boolean;
  selectionIndicator?: boolean;
  tone?: ModelBrowserRowTone;
  /** For rows that offer an action rather than name a thing you can pick. */
  labelMuted?: boolean;
  spacing?: "model" | "provider";
  onPress: () => void;
  testID?: string;
}) {
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.browserRow,
      Boolean(trailingAction) && styles.browserRowWithAction,
      spacing === "model" && styles.browserModelRow,
      Boolean(hovered) &&
        (tone === "elevated" ? styles.browserRowHoveredElevated : styles.browserRowHovered),
      pressed && (tone === "default" ? styles.browserRowPressed : styles.browserRowPressedElevated),
    ],
    [spacing, tone, trailingAction],
  );
  const contentStyle = useMemo(
    () => [styles.browserRowText, description && styles.browserRowTextInline],
    [description],
  );
  const hasTrailing = selected || trailingSlot;

  const row = (
    <ModelBrowserPressable
      onPress={onPress}
      style={pressableStyle}
      // A profile row is an action, not a selection, so it carries no selection
      // state at all — only rows that draw the checkmark claim one.
      accessibilitySelected={selectionIndicator ? selected : undefined}
      testID={testID}
    >
      <View style={styles.browserRowContent}>
        <View style={styles.browserRowLeading}>{leadingSlot}</View>
        <View style={contentStyle}>
          <Text
            numberOfLines={1}
            style={labelMuted ? styles.browserRowLabelMuted : styles.browserRowLabel}
          >
            {label}
          </Text>
          {description ? (
            <Text numberOfLines={1} style={styles.browserRowDescription}>
              {description}
            </Text>
          ) : null}
        </View>
        {hasTrailing ? (
          <View style={styles.browserRowTrailing}>
            {selectionIndicator ? (
              <View style={styles.browserRowSelection}>
                {selected ? <ThemedCheck size="sm" uniProps={foregroundMutedMapping} /> : null}
              </View>
            ) : null}
            {trailingSlot}
          </View>
        ) : null}
      </View>
    </ModelBrowserPressable>
  );

  if (!trailingAction) return row;

  return (
    <View style={styles.browserRowActionRow}>
      {row}
      <View style={styles.browserRowAction}>{trailingAction}</View>
    </View>
  );
}

function ModelRow({
  row,
  isSelected,
  showProviderLabel = false,
  onPress,
}: {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  showProviderLabel?: boolean;
  onPress: () => void;
}) {
  const leadingSlot = useMemo(
    () =>
      row.provider === "otto-brain" && row.family ? (
        <ThemedBrainModelFamilyIcon family={row.family} size="sm" />
      ) : (
        <ModelProviderGlyph provider={row.provider} size="sm" />
      ),
    [row.family, row.provider],
  );

  const description = showProviderLabel ? buildProviderQualifiedDescription(row) : row.description;

  return (
    <ModelBrowserRow
      label={row.modelLabel}
      description={description}
      selected={isSelected}
      selectionIndicator
      onPress={onPress}
      leadingSlot={leadingSlot}
      testID={`model-row-${row.provider}-${row.modelId}`}
    />
  );
}

function SelectableModelRow({
  row,
  isSelected,
  showProviderLabel,
  onSelect,
}: {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  showProviderLabel?: boolean;
  onSelect: (provider: string, modelId: string) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(row.provider, row.modelId);
  }, [onSelect, row.modelId, row.provider]);
  return (
    <ModelRow
      row={row}
      isSelected={isSelected}
      showProviderLabel={showProviderLabel}
      onPress={handlePress}
    />
  );
}

/**
 * Pinned above the provider list. This is the same Personalities section the
 * desktop picker draws, so the two surfaces cannot drift on label, colour, or
 * selected-row behaviour.
 */
function PersonalityPickerContent({
  rows,
  selectedProfileId,
  onSelectProfile,
  onClearProfile,
  onEditProfiles,
}: {
  rows: SelectorProfile[] | undefined;
  selectedProfileId: string | null;
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
  onEditProfiles?: () => void;
}) {
  if (!rows || rows.length === 0) {
    return onEditProfiles ? <CreateAgentProfileRow onPress={onEditProfiles} /> : null;
  }
  return (
    <PersonalitiesSection
      personalities={rows}
      selectedProfileId={selectedProfileId}
      onSelectProfile={onSelectProfile}
      onClearProfile={onClearProfile}
    />
  );
}

function CreateAgentProfileRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const leadingSlot = useMemo(
    () => (
      <View testID="model-profiles-create-icon">
        <ThemedPlus size="sm" uniProps={foregroundMutedMapping} />
      </View>
    ),
    [],
  );
  return (
    <ModelBrowserRow
      label={t("modelSelector.createProfile")}
      labelMuted
      leadingSlot={leadingSlot}
      onPress={onPress}
      testID="model-profiles-empty"
    />
  );
}

function GroupProviderButton({
  provider,
  onDrillDown,
}: {
  provider: ProviderSelectorProvider;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  const { t } = useTranslation();
  const selection = provider.modelSelection;
  const handlePress = useCallback(() => {
    onDrillDown(provider.id, provider.label);
  }, [onDrillDown, provider.id, provider.label]);

  const stateNode = useMemo(() => {
    if (selection.kind === "models") {
      const count = selection.rows.length;
      return (
        <Text style={styles.drillDownCount}>
          {t(count === 1 ? "modelSelector.modelCount" : "modelSelector.modelCountPlural", {
            count,
          })}
        </Text>
      );
    }
    if (selection.kind === "loading") {
      return (
        <View style={styles.rowStateInline}>
          <View style={styles.rowSpinner}>
            <ThemedLoadingSpinner size="sm" uniProps={foregroundMutedMapping} />
          </View>
          <Text style={styles.drillDownCount}>{t("modelSelector.loadingShort")}</Text>
        </View>
      );
    }
    return (
      <View style={styles.rowStateInline}>
        <ThemedAlertTriangle size="sm" uniProps={foregroundMutedMapping} />
        <Text style={styles.drillDownCount}>{t("modelSelector.error")}</Text>
      </View>
    );
  }, [selection, t]);
  const leadingSlot = useMemo(
    () => <ModelProviderGlyph provider={provider.id} size="sm" />,
    [provider.id],
  );
  const trailingSlot = useMemo(
    () => (
      <View style={styles.drillDownTrailing}>
        {stateNode}
        <ThemedChevronRight size="sm" uniProps={foregroundMutedMapping} />
      </View>
    ),
    [stateNode],
  );

  return (
    <ModelBrowserRow
      label={provider.label}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      tone="drillDown"
      spacing="provider"
      onPress={handlePress}
      testID={`model-provider-${provider.id}`}
    />
  );
}

function GroupedProviderRows({
  providers,
  onDrillDown,
}: {
  providers: ProviderSelectorProvider[];
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  return (
    <View>
      {providers.map((provider, index) => (
        <View key={provider.id}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <GroupProviderButton provider={provider} onDrillDown={onDrillDown} />
        </View>
      ))}
    </View>
  );
}

function IndependentScrollBoundary({ children }: { children: React.ReactElement }) {
  // Prevent the parent sheet from cancelling Android's native scroll when the
  // finger crosses this viewport; receiving ACTION_UP is what preserves fling.
  const nativeScrollGesture = useMemo(
    () =>
      Gesture.Native()
        .shouldActivateOnStart(true)
        .shouldCancelWhenOutside(false)
        .disallowInterruption(true),
    [],
  );

  if (Platform.OS !== "android") {
    return children;
  }

  return (
    <IndependentScrollGestureContext.Provider value={nativeScrollGesture}>
      <GestureDetector gesture={nativeScrollGesture}>{children}</GestureDetector>
    </IndependentScrollGestureContext.Provider>
  );
}

function IndependentModelList({
  rows,
  renderItem,
  header,
}: {
  rows: ProviderSelectionModelRow[];
  renderItem: ({ item }: { item: ProviderSelectionModelRow }) => React.ReactElement;
  header?: React.ReactElement;
}) {
  return (
    <IndependentScrollBoundary>
      <FlatList
        data={rows}
        renderItem={renderItem}
        ListHeaderComponent={header}
        keyExtractor={getModelRowKey}
        style={styles.virtualizedModelList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.virtualizedModelListContent}
        nestedScrollEnabled
        testID="compact-model-list"
      />
    </IndependentScrollBoundary>
  );
}

function getModelRowKey(row: ProviderSelectionModelRow): string {
  return row.favoriteKey;
}

function IndependentProviderList({ children }: { children: React.ReactNode }) {
  return (
    <IndependentScrollBoundary>
      <ScrollView
        style={styles.virtualizedModelList}
        contentContainerStyle={[
          styles.virtualizedModelListContent,
          styles.virtualizedProviderListContent,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        testID="compact-provider-list"
      >
        {children}
      </ScrollView>
    </IndependentScrollBoundary>
  );
}

function ModelRowList({
  rows,
  selectedProvider,
  selectedModel,
  onSelect,
  showProviderLabel = false,
  header,
  scrolling,
}: {
  rows: ProviderSelectionModelRow[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: string, modelId: string) => void;
  showProviderLabel?: boolean;
  header?: React.ReactElement;
  scrolling: "sheet" | "independent";
}) {
  const isCompact = useIsCompactFormFactor();
  const renderItem = useCallback(
    ({ item }: { item: ProviderSelectionModelRow }) => (
      <SelectableModelRow
        row={item}
        isSelected={item.provider === selectedProvider && item.modelId === selectedModel}
        showProviderLabel={showProviderLabel}
        onSelect={onSelect}
      />
    ),
    [onSelect, selectedModel, selectedProvider, showProviderLabel],
  );
  const keyExtractor = useCallback((row: ProviderSelectionModelRow) => row.favoriteKey, []);

  if (scrolling === "independent") {
    return <IndependentModelList rows={rows} renderItem={renderItem} header={header} />;
  }

  if (isCompact && isNative) {
    return (
      <BottomSheetFlatList
        data={rows}
        renderItem={renderItem}
        ListHeaderComponent={header}
        keyExtractor={keyExtractor}
        style={styles.virtualizedModelList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.virtualizedModelListContent}
      />
    );
  }

  return (
    <View>
      {header}
      {rows.map((row) => (
        <View key={row.favoriteKey}>{renderItem({ item: row })}</View>
      ))}
    </View>
  );
}

function ProviderErrorEmptyState({
  providerId,
  providerLabel,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  providerLabel: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const presentedMessage = useMemo(
    () => presentProviderModelSelectionError({ providerLabel, message }),
    [message, providerLabel],
  );
  const handleRetry = useCallback(() => {
    onRetryProvider?.(providerId);
  }, [onRetryProvider, providerId]);
  return (
    <View style={styles.emptyState}>
      <ThemedAlertTriangle size="md" uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{presentedMessage}</Text>
      {onRetryProvider ? (
        <Button variant="default" size="sm" onPress={handleRetry} disabled={isRetryingProvider}>
          {isRetryingProvider ? t("modelSelector.retrying") : t("modelSelector.retry")}
        </Button>
      ) : null}
    </View>
  );
}

function ModelSearchEmptyState() {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState}>
      <ThemedSearch size="md" uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
    </View>
  );
}

function ProviderModelBrowserContent({
  view,
  provider,
  personality,
  selectedProvider,
  selectedModel,
  normalizedQuery,
  onSelect,
  onSelectProfile,
  onClearProfile,
  onEditProfiles,
  onRetryProvider,
  isRetryingProvider,
  scrolling,
}: {
  view: Extract<ModelBrowserView, { kind: "provider" }>;
  provider: ProviderSelectorProvider | null;
  personality: RolePersonality | null;
  selectedProvider: string;
  selectedModel: string;
  normalizedQuery: string;
  onSelect: (provider: string, modelId: string) => void;
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
  onEditProfiles?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
  scrolling: "sheet" | "independent";
}) {
  const { t } = useTranslation();
  const visibleRows = useMemo(
    () => (provider ? filterAndRankModelRows(getProviderModelRows(provider), normalizedQuery) : []),
    [normalizedQuery, provider],
  );
  // The family view lists only this provider Personalities: a running agent is
  // one provider process, and the draft form drills in per family.
  const providerPersonalityRows = useMemo(
    () => personality?.personalities?.filter((row) => row.provider === view.providerId) ?? [],
    [personality, view.providerId],
  );
  const profileHeader = useMemo(
    () =>
      normalizedQuery.length === 0 && personality ? (
        <PersonalityPickerContent
          rows={providerPersonalityRows}
          selectedProfileId={personality.selectedProfileId}
          onSelectProfile={onSelectProfile}
          onClearProfile={onClearProfile}
          onEditProfiles={onEditProfiles}
        />
      ) : undefined,
    [
      normalizedQuery,
      onClearProfile,
      onEditProfiles,
      onSelectProfile,
      personality,
      providerPersonalityRows,
    ],
  );

  if (!provider) return <ModelSearchEmptyState />;
  const selection = provider.modelSelection;
  if (selection.kind === "loading") {
    return (
      <View style={styles.emptyState}>
        <View style={styles.rowSpinner}>
          <ThemedLoadingSpinner size="sm" uniProps={foregroundMutedMapping} />
        </View>
        <Text style={styles.emptyStateText}>{t("modelSelector.loadingShort")}</Text>
      </View>
    );
  }
  if (selection.kind === "error") {
    return (
      <ProviderErrorEmptyState
        providerId={view.providerId}
        providerLabel={view.providerLabel}
        message={selection.message}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
      />
    );
  }
  if (visibleRows.length === 0) {
    return profileHeader ?? <ModelSearchEmptyState />;
  }
  return (
    <ModelRowList
      rows={visibleRows}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      onSelect={onSelect}
      header={profileHeader}
      scrolling={scrolling}
    />
  );
}

function ModelBrowserContent({
  view,
  providers,
  selectedProvider,
  selectedModel,
  searchQuery,
  isSearchFocused,
  personality,
  onSelect,
  onSelectProfile,
  onClearProfile,
  onEditProfiles,
  onDrillDown,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling,
}: ModelBrowserContentProps) {
  const { t } = useTranslation();
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const selectedViewProvider = useMemo(
    () =>
      view.kind === "provider"
        ? (providers.find((provider) => provider.id === view.providerId) ?? null)
        : null,
    [providers, view],
  );
  const allView = useMemo(
    () => resolveModelBrowserAllView({ providers, normalizedQuery, isSearchFocused }),
    [isSearchFocused, normalizedQuery, providers],
  );
  const hasResults = personality !== null || providers.length > 0;

  if (view.kind === "provider") {
    return (
      <ProviderModelBrowserContent
        view={view}
        provider={selectedViewProvider}
        personality={personality}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        normalizedQuery={normalizedQuery}
        onSelect={onSelect}
        onSelectProfile={onSelectProfile}
        onClearProfile={onClearProfile}
        onEditProfiles={onEditProfiles}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
        scrolling={scrolling}
      />
    );
  }

  if (allView.kind === "noSearchMatches") {
    return (
      <View style={styles.emptyState} testID="model-search-empty">
        <ThemedSearch size="md" uniProps={foregroundMutedMapping} />
        <Text style={styles.emptyStateText}>
          {t("modelSelector.noMatchesForQuery", { query: searchQuery.trim() })}
        </Text>
      </View>
    );
  }

  if (allView.kind === "searchResults") {
    return (
      <ModelRowList
        rows={allView.rows}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onSelect={onSelect}
        showProviderLabel
        scrolling={scrolling}
      />
    );
  }

  const allProvidersContent = (
    <View>
      {personality ? (
        <PersonalityPickerContent
          rows={personality.personalities}
          selectedProfileId={personality.selectedProfileId}
          onSelectProfile={onSelectProfile}
          onClearProfile={onClearProfile}
          onEditProfiles={onEditProfiles}
        />
      ) : null}
      {providers.length > 0 ? (
        <View>
          {personality ? (
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionHeadingText}>{t("modelSelector.providers")}</Text>
            </View>
          ) : null}
          <GroupedProviderRows providers={providers} onDrillDown={onDrillDown} />
        </View>
      ) : null}
      {!hasResults ? <ModelSearchEmptyState /> : null}
    </View>
  );

  return scrolling === "independent" ? (
    <IndependentProviderList>{allProvidersContent}</IndependentProviderList>
  ) : (
    allProvidersContent
  );
}

export function ModelBrowser({
  state,
  onSelect,
  onSelectProfile,
  onClearProfile,
  onEditProfiles,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling = "sheet",
}: ModelBrowserProps) {
  return (
    <ModelBrowserContent
      view={state.view}
      providers={state.providers}
      selectedProvider={state.selectedProvider}
      selectedModel={state.selectedModel}
      searchQuery={state.searchQuery}
      isSearchFocused={state.isSearchFocused}
      personality={state.personality}
      onSelect={onSelect}
      onSelectProfile={onSelectProfile}
      onClearProfile={onClearProfile}
      onEditProfiles={onEditProfiles}
      onDrillDown={state.drillDown}
      onRetryProvider={onRetryProvider}
      isRetryingProvider={isRetryingProvider}
      scrolling={scrolling}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  headerActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  profilesContainer: {
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  sectionHeading: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: isWeb ? theme.spacing[3] : theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  sectionHeadingAction: {
    position: "absolute",
    top: theme.spacing[1],
    right: isWeb ? theme.spacing[3] : theme.spacing[6],
  },
  sectionHeadingText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  browserRow: {
    flexDirection: "row",
    paddingVertical: theme.spacing[2],
    minHeight: 36,
  },
  browserModelRow: isWeb ? {} : { marginBottom: theme.spacing[1] },
  browserRowWithAction: {
    flex: 1,
  },
  browserRowActionRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  browserRowAction: {
    alignItems: "center",
    justifyContent: "center",
    paddingRight: isWeb ? theme.spacing[3] : theme.spacing[6],
  },
  browserRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  browserRowHoveredElevated: {
    backgroundColor: theme.colors.surface2,
  },
  browserRowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  browserRowPressedElevated: {
    backgroundColor: theme.colors.surface2,
  },
  browserRowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: isWeb ? theme.spacing[3] : theme.spacing[6],
  },
  browserRowLeading: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  browserRowText: {
    flex: 1,
    flexShrink: 1,
  },
  browserRowTextInline: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  browserRowLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  browserRowLabelMuted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  browserRowDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  browserRowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
  },
  browserRowSelection: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  drillDownTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  drillDownCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  rowStateInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  rowIconButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowSpinner: {
    transform: [{ scale: 0.7 }],
  },
  rowIconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  emptyState: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyStateText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  virtualizedModelList: {
    flex: 1,
  },
  virtualizedModelListContent: {
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[8],
  },
  virtualizedProviderListContent: {
    paddingTop: 0,
  },
  providerIconMuted: {
    color: theme.colors.foregroundMuted,
  },
  providerIconForeground: {
    color: theme.colors.foreground,
  },
}));
