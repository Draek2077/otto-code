import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb as platformIsWeb } from "@/constants/platform";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  type IconComponent,
  Search,
  Settings,
  Star,
  StarFilled,
} from "@/components/icons/material-icons";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { Button } from "@/components/ui/button";
import { compactUp, ICON_SIZE, useIconSize, type Theme } from "@/styles/theme";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import { getProviderIcon } from "@/components/provider-icons";
import {
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  resolveSelectedModelLabel,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

const IS_WEB = platformIsWeb;
const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];

function noop() {}

function favoriteButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.favoriteButton,
    Boolean(hovered) && styles.favoriteButtonHovered,
    pressed && styles.favoriteButtonPressed,
  ];
}

function drillDownRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.drillDownRow,
    Boolean(hovered) && styles.drillDownRowHovered,
    pressed && styles.drillDownRowPressed,
  ];
}

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;
// personalityRow carries minHeight 44 (taller than a model row: name +
// subtitle); the section renders a heading line above the rows.
const DESKTOP_PERSONALITY_ROW_HEIGHT = 44;
const DESKTOP_PERSONALITY_HEADING_HEIGHT = 28;

const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedSearch = withUnistyles(Search);
const ThemedSettings = withUnistyles(Settings);
const ThemedStar = withUnistyles(Star);
const ThemedStarFilled = withUnistyles(StarFilled);

const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });

/**
 * Presentation view-model for a personality row in the picker. The selector is
 * pure presentation — callers (via usePersonalitySelection) build these,
 * including availability, so the component never touches daemon config.
 */
export interface SelectorPersonality {
  id: string;
  name: string;
  /** Provider id — picks the glyph filled with the personality's gradient. */
  provider: string;
  subtitle: string;
  glowA?: string;
  glowB?: string;
  available: boolean;
  unavailableReason?: string;
  /**
   * A neutral leading glyph that REPLACES the colored provider icon — used by
   * the synthetic "Team's <Role>" entry, whose concrete holder changes with the
   * active team, so wearing any one personality's provider glyph would mislead.
   * A plain role icon makes clear you're picking a role, not that personality.
   */
  roleIcon?: IconComponent;
}

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const headerSettingsMapping = (disabled: boolean) => (theme: Theme) => ({
  color: disabled ? theme.colors.border : theme.colors.foregroundMuted,
});

// Material Symbols have no `fill` prop — the filled state swaps to the
// StarFilled glyph instead.
const favoriteStarMapping =
  (isFavorite: boolean, hovered: boolean) =>
  (theme: Theme): { color: string } => {
    if (isFavorite) {
      return { color: theme.colors.palette.amber[500] };
    }
    return {
      color: hovered ? theme.colors.foregroundMuted : theme.colors.border,
    };
  };

type ProviderGlyphTone = "muted" | "foreground";

function ProviderGlyph({
  provider,
  size,
  tone = "muted",
}: {
  provider: string;
  size: number;
  tone?: ProviderGlyphTone;
}) {
  const Icon = getProviderIcon(provider);
  const color =
    tone === "foreground" ? styles.providerIconForeground.color : styles.providerIconMuted.color;
  return <Icon size={size} color={color} />;
}

/**
 * Leading glyph for the selector trigger. With a selected personality that
 * carries both spinner colors, the provider icon is filled with those colors as
 * a static 45° gradient (identity without an animated spinner); otherwise the
 * plain provider glyph. Nothing when there is no provider.
 */
function TriggerLeadingIcon({
  personality,
  provider,
  size,
}: {
  personality: SelectorPersonality | null;
  provider: string | null;
  size: number;
}) {
  // A role-slot entry (Team's <Role>) wears its neutral role glyph, not the
  // current holder's colored provider icon.
  if (personality?.roleIcon) {
    const RoleIcon = personality.roleIcon;
    return <RoleIcon size={size} color={styles.providerIconForeground.color} />;
  }
  if (!provider) {
    return null;
  }
  if (personality) {
    return (
      <PersonalityProviderIcon
        provider={provider}
        size={size}
        glowA={personality.glowA}
        glowB={personality.glowB}
      />
    );
  }
  return <ProviderGlyph provider={provider} size={size} />;
}

function HeaderSettingsIcon({ disabled }: { disabled: boolean }) {
  const uniProps = useMemo(() => headerSettingsMapping(disabled), [disabled]);
  return <ThemedSettings size={ICON_SIZE.sm} uniProps={uniProps} />;
}

function FavoriteStar({ isFavorite, hovered }: { isFavorite: boolean; hovered: boolean }) {
  const uniProps = useMemo(() => favoriteStarMapping(isFavorite, hovered), [hovered, isFavorite]);
  const ThemedIcon = isFavorite ? ThemedStarFilled : ThemedStar;
  return <ThemedIcon size={ICON_SIZE.md} uniProps={uniProps} />;
}

type SelectorView =
  | { kind: "all" }
  | { kind: "provider"; providerId: string; providerLabel: string };

interface CombinedModelSelectorProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: AgentProvider, modelId: string) => void;
  isLoading: boolean;
  favoriteKeys?: Set<string>;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  renderTrigger?: (input: {
    selectedModelLabel: string;
    onPress: () => void;
    disabled: boolean;
    isOpen: boolean;
    hovered: boolean;
    pressed: boolean;
  }) => React.ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  /**
   * Optional personality roster, rendered as a section above the model list.
   * Selecting one auto-fills provider/model/effort/mode via the caller's
   * onSelectPersonality; the caller keeps the selected id (deviation keeps
   * identity). Empty/undefined hides the section entirely.
   */
  personalities?: SelectorPersonality[];
  selectedPersonalityId?: string | null;
  onSelectPersonality?: (id: string) => void;
  onClearPersonality?: () => void;
  /**
   * Picking a raw model while a personality is selected. When provided, the
   * picker routes the model pick here INSTEAD of onSelect+onClearPersonality —
   * the owner confirms once and applies "clear personality + set model" as a
   * single flow (running agents, RPC-backed). Absent ⇒ legacy behavior:
   * onSelect fires and onClearPersonality (if any) clears client-side (draft
   * surfaces).
   */
  onSelectModelOverPersonality?: (provider: string, modelId: string) => void;
  /**
   * Render the custom trigger as a full-width form field: the outer Pressable
   * becomes a transparent passthrough that stretches its child edge-to-edge and
   * stops painting its own hover/pressed background and rounded corners. The
   * trigger itself owns the field visuals and reads hovered/pressed to show its
   * active state. Without this the trigger stays a content-width toolbar chip
   * (the composer's layout).
   */
  triggerFill?: boolean;
  /**
   * Replace the default trigger's leading glyph with a spinner — a live
   * personality switch is applying on the daemon. The compact icon-only custom
   * trigger renders its own spinner (renderTrigger bypasses this).
   */
  triggerLoading?: boolean;
}

interface SelectorContentProps {
  view: SelectorView;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  searchQuery: string;
  favoriteKeys: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
  personalities?: SelectorPersonality[];
  selectedPersonalityId?: string | null;
  onSelectPersonality?: (id: string) => void;
  onClearPersonality?: () => void;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function sortFavoritesFirst(
  rows: ProviderSelectionModelRow[],
  favoriteKeys: Set<string>,
): ProviderSelectionModelRow[] {
  const favorites: ProviderSelectionModelRow[] = [];
  const rest: ProviderSelectionModelRow[] = [];
  for (const row of rows) {
    if (favoriteKeys.has(row.favoriteKey)) {
      favorites.push(row);
    } else {
      rest.push(row);
    }
  }
  return [...favorites, ...rest];
}

function ModelRow({
  row,
  isSelected,
  isFavorite,
  elevated = false,
  onPress,
  onToggleFavorite,
}: {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  isFavorite: boolean;
  elevated?: boolean;
  onPress: () => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}) {
  const { t } = useTranslation();

  const handleToggleFavorite = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggleFavorite?.(row.provider, row.modelId);
    },
    [onToggleFavorite, row.modelId, row.provider],
  );

  const leadingSlot = useMemo(
    () => <ProviderGlyph provider={row.provider} size={ICON_SIZE.sm} />,
    [row.provider],
  );
  const trailingSlot = useMemo(
    () =>
      onToggleFavorite ? (
        <Pressable
          onPress={handleToggleFavorite}
          hitSlop={8}
          style={favoriteButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={
            isFavorite ? t("modelSelector.unfavoriteModel") : t("modelSelector.favoriteModel")
          }
          testID={`favorite-model-${row.provider}-${row.modelId}`}
        >
          {({ hovered }) => <FavoriteStar isFavorite={isFavorite} hovered={Boolean(hovered)} />}
        </Pressable>
      ) : null,
    [onToggleFavorite, handleToggleFavorite, isFavorite, row.provider, row.modelId, t],
  );

  return (
    <ComboboxItem
      label={row.modelLabel}
      description={row.description}
      selected={isSelected}
      elevated={elevated}
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
    />
  );
}

interface SelectableModelRowProps {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  isFavorite: boolean;
  elevated?: boolean;
  onSelect: (provider: string, modelId: string) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}

function SelectableModelRow({
  row,
  isSelected,
  isFavorite,
  elevated,
  onSelect,
  onToggleFavorite,
}: SelectableModelRowProps) {
  const handlePress = useCallback(() => {
    onSelect(row.provider, row.modelId);
  }, [onSelect, row.provider, row.modelId]);
  return (
    <ModelRow
      row={row}
      isSelected={isSelected}
      isFavorite={isFavorite}
      elevated={elevated}
      onPress={handlePress}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

function FavoritesSection({
  favoriteRows,
  selectedProvider,
  selectedModel,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
}: {
  favoriteRows: ProviderSelectionModelRow[];
  selectedProvider: string;
  selectedModel: string;
  favoriteKeys: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}) {
  const { t } = useTranslation();
  if (favoriteRows.length === 0) {
    return null;
  }

  return (
    <View style={styles.favoritesContainer}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionHeadingText}>{t("modelSelector.favorites")}</Text>
      </View>
      {favoriteRows.map((row) => (
        <SelectableModelRow
          key={row.favoriteKey}
          row={row}
          isSelected={row.provider === selectedProvider && row.modelId === selectedModel}
          isFavorite={favoriteKeys.has(row.favoriteKey)}
          elevated
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </View>
  );
}

interface GroupProviderButtonProps {
  provider: ProviderSelectorProvider;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.rowIconButton,
    Boolean(hovered) && styles.rowIconButtonHovered,
    pressed && styles.rowIconButtonPressed,
  ];
}

function GroupProviderButton({ provider, onDrillDown }: GroupProviderButtonProps) {
  const { t } = useTranslation();
  const selection = provider.modelSelection;

  const handlePress = useCallback(() => {
    onDrillDown(provider.id, provider.label);
  }, [onDrillDown, provider.id, provider.label]);

  let stateNode: React.ReactNode;
  if (selection.kind === "models") {
    const count = selection.rows.length;
    stateNode = (
      <Text style={styles.drillDownCount}>
        {t(count === 1 ? "modelSelector.modelCount" : "modelSelector.modelCountPlural", {
          count,
        })}
      </Text>
    );
  } else if (selection.kind === "loading") {
    stateNode = (
      <View style={styles.rowStateInline}>
        <View style={styles.rowSpinner}>
          <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
        </View>
        <Text style={styles.drillDownCount}>{t("modelSelector.loadingShort")}</Text>
      </View>
    );
  } else {
    stateNode = (
      <View style={styles.rowStateInline}>
        <ThemedAlertTriangle size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
        <Text style={styles.drillDownCount}>{t("modelSelector.error")}</Text>
      </View>
    );
  }

  return (
    <Pressable onPress={handlePress} style={drillDownRowStyle}>
      <ProviderGlyph provider={provider.id} size={ICON_SIZE.sm} />
      <Text style={styles.drillDownText}>{provider.label}</Text>
      <View style={styles.drillDownTrailing}>
        {stateNode}
        <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
      </View>
    </Pressable>
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

function ProviderModelRows({
  rows,
  selectedProvider,
  selectedModel,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  normalizedQuery,
}: {
  rows: ProviderSelectionModelRow[];
  selectedProvider: string;
  selectedModel: string;
  favoriteKeys: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  normalizedQuery: string;
}) {
  const isMobile = useIsCompactFormFactor();
  const useVirtualizedList = isMobile && isNative;
  const displayRows = useMemo(
    () => (normalizedQuery ? rows : sortFavoritesFirst(rows, favoriteKeys)),
    [favoriteKeys, normalizedQuery, rows],
  );
  const renderItem = useCallback(
    ({ item }: { item: ProviderSelectionModelRow }) => (
      <SelectableModelRow
        row={item}
        isSelected={item.provider === selectedProvider && item.modelId === selectedModel}
        isFavorite={favoriteKeys.has(item.favoriteKey)}
        onSelect={onSelect}
        onToggleFavorite={onToggleFavorite}
      />
    ),
    [favoriteKeys, onSelect, onToggleFavorite, selectedModel, selectedProvider],
  );
  const keyExtractor = useCallback((row: ProviderSelectionModelRow) => row.favoriteKey, []);

  if (useVirtualizedList) {
    return (
      <BottomSheetFlatList
        data={displayRows}
        renderItem={renderItem}
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
      {displayRows.map((row) => (
        <View key={row.favoriteKey}>{renderItem({ item: row })}</View>
      ))}
    </View>
  );
}

function ProviderErrorEmptyState({
  providerId,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => {
    onRetryProvider?.(providerId);
  }, [onRetryProvider, providerId]);
  return (
    <View style={styles.emptyState}>
      <ThemedAlertTriangle size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{message}</Text>
      {onRetryProvider ? (
        <Button variant="default" size="sm" onPress={handleRetry} disabled={isRetryingProvider}>
          {isRetryingProvider ? t("modelSelector.retrying") : t("modelSelector.retry")}
        </Button>
      ) : null}
    </View>
  );
}

// A role-slot entry (Team's <Role>) shows a neutral role glyph so it reads as
// picking a role; a concrete personality keeps its colored provider glyph.
function PersonalityRowIcon({ personality }: { personality: SelectorPersonality }) {
  if (personality.roleIcon) {
    const RoleIcon = personality.roleIcon;
    return <RoleIcon size={ICON_SIZE.md} color={styles.providerIconForeground.color} />;
  }
  return (
    <PersonalityProviderIcon
      provider={personality.provider}
      size={ICON_SIZE.md}
      glowA={personality.glowA}
      glowB={personality.glowB}
    />
  );
}

function PersonalityRow({
  personality,
  isSelected,
  onSelect,
  onClear,
}: {
  personality: SelectorPersonality;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const handlePress = useCallback(() => {
    if (!personality.available) return;
    if (isSelected) {
      onClear();
    } else {
      onSelect(personality.id);
    }
  }, [personality.available, personality.id, isSelected, onSelect, onClear]);

  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.personalityRow,
      Boolean(hovered) && personality.available && styles.drillDownRowHovered,
      pressed && personality.available && styles.drillDownRowPressed,
      !personality.available && styles.personalityRowDisabled,
    ],
    [personality.available],
  );
  const a11yState = useMemo(
    () => ({ selected: isSelected, disabled: !personality.available }),
    [isSelected, personality.available],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={!personality.available}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityState={a11yState}
      testID={`personality-row-${personality.id}`}
    >
      <PersonalityRowIcon personality={personality} />
      <View style={styles.personalityText}>
        <Text style={styles.personalityName} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={styles.personalitySubtitle} numberOfLines={1}>
          {personality.available
            ? personality.subtitle
            : (personality.unavailableReason ?? personality.subtitle)}
        </Text>
      </View>
      {isSelected ? <ThemedCheck size={ICON_SIZE.sm} uniProps={accentMapping} /> : null}
    </Pressable>
  );
}

function PersonalitiesSection({
  personalities,
  selectedPersonalityId,
  onSelectPersonality,
  onClearPersonality,
}: {
  personalities?: SelectorPersonality[];
  selectedPersonalityId?: string | null;
  onSelectPersonality?: (id: string) => void;
  onClearPersonality?: () => void;
}) {
  if (!personalities || personalities.length === 0 || !onSelectPersonality) {
    return null;
  }
  const handleClear = onClearPersonality ?? noop;
  return (
    <View style={styles.personalitiesContainer}>
      <View style={styles.sectionHeading}>
        {/* i18n: English-only pending the agent-personalities translation pass. */}
        <Text style={styles.sectionHeadingText}>Personalities</Text>
      </View>
      {personalities.map((personality) => (
        <PersonalityRow
          key={personality.id}
          personality={personality}
          isSelected={personality.id === selectedPersonalityId}
          onSelect={onSelectPersonality}
          onClear={handleClear}
        />
      ))}
    </View>
  );
}

function SelectorContent({
  view,
  providers,
  selectedProvider,
  selectedModel,
  searchQuery,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  onDrillDown,
  onRetryProvider,
  isRetryingProvider,
  personalities,
  selectedPersonalityId,
  onSelectPersonality,
  onClearPersonality,
}: SelectorContentProps) {
  const { t } = useTranslation();
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const selectedViewProvider = useMemo(
    () =>
      view.kind === "provider"
        ? providers.find((provider) => provider.id === view.providerId)
        : null,
    [providers, view],
  );
  const visibleRows = useMemo(
    () =>
      selectedViewProvider
        ? filterAndRankModelRows(getProviderModelRows(selectedViewProvider), normalizedQuery)
        : [],
    [normalizedQuery, selectedViewProvider],
  );
  const favoriteRows = useMemo(
    () => getAllProviderModelRows(providers).filter((row) => favoriteKeys.has(row.favoriteKey)),
    [favoriteKeys, providers],
  );
  const hasResults =
    favoriteRows.length > 0 || providers.length > 0 || (personalities?.length ?? 0) > 0;
  const emptyState = (
    <View style={styles.emptyState}>
      <ThemedSearch size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
    </View>
  );

  if (view.kind === "provider") {
    if (!selectedViewProvider) {
      return emptyState;
    }
    // Personalities that belong to this family, pinned above the model list so a
    // family menu (including a locked running chat agent's) lets you pick one of
    // its personalities as readily as a raw model. The search box filters these by
    // name alongside the models. Renders nothing when the roster is read-only (no
    // onSelectPersonality) or has none matching for this family.
    const familyPersonalities = personalities?.filter(
      (entry) =>
        entry.provider === view.providerId &&
        (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)),
    );
    const familyPersonalitiesNode = (
      <PersonalitiesSection
        personalities={familyPersonalities}
        selectedPersonalityId={selectedPersonalityId}
        onSelectPersonality={onSelectPersonality}
        onClearPersonality={onClearPersonality}
      />
    );
    const drillSelection = selectedViewProvider.modelSelection;
    if (drillSelection.kind === "loading") {
      return (
        <View>
          {familyPersonalitiesNode}
          <View style={styles.emptyState}>
            <View style={styles.rowSpinner}>
              <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
            </View>
            <Text style={styles.emptyStateText}>{t("modelSelector.loadingShort")}</Text>
          </View>
        </View>
      );
    }
    if (drillSelection.kind === "error") {
      return (
        <View>
          {familyPersonalitiesNode}
          <ProviderErrorEmptyState
            providerId={view.providerId}
            message={drillSelection.message}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
          />
        </View>
      );
    }

    // Only fall back to "no matches" when nothing — models or personalities —
    // survived the filter, so a personality-only match doesn't read as empty.
    const hasFamilyPersonalityMatch =
      Boolean(onSelectPersonality) && (familyPersonalities?.length ?? 0) > 0;
    let modelBody: React.ReactNode = null;
    if (visibleRows.length > 0) {
      modelBody = (
        <ProviderModelRows
          rows={visibleRows}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          favoriteKeys={favoriteKeys}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          normalizedQuery={normalizedQuery}
        />
      );
    } else if (!hasFamilyPersonalityMatch) {
      modelBody = emptyState;
    }
    return (
      <View>
        {familyPersonalitiesNode}
        {modelBody}
      </View>
    );
  }

  return (
    <View>
      <PersonalitiesSection
        personalities={personalities}
        selectedPersonalityId={selectedPersonalityId}
        onSelectPersonality={onSelectPersonality}
        onClearPersonality={onClearPersonality}
      />

      <FavoritesSection
        favoriteRows={favoriteRows}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        favoriteKeys={favoriteKeys}
        onSelect={onSelect}
        onToggleFavorite={onToggleFavorite}
      />

      {providers.length > 0 ? (
        <GroupedProviderRows providers={providers} onDrillDown={onDrillDown} />
      ) : null}

      {!hasResults ? emptyState : null}
    </View>
  );
}

export function CombinedModelSelector({
  providers,
  selectedProvider,
  selectedModel,
  onSelect,
  isLoading,
  favoriteKeys = new Set<string>(),
  onToggleFavorite,
  renderTrigger,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
  desktopPlacement,
  desktopMinWidth,
  personalities,
  selectedPersonalityId = null,
  onSelectPersonality,
  onClearPersonality,
  onSelectModelOverPersonality,
  triggerFill = false,
  triggerLoading = false,
}: CombinedModelSelectorProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  // Live icon size — the static ICON_SIZE import never sees the compact
  // doubling, which would leave this trigger's glyph half the size of the
  // neighboring mode/effort chip icons on compact breakpoints.
  const iconSize = useIconSize();
  const [isOpen, setIsOpen] = useState(false);
  const [isContentReady, setIsContentReady] = useState(platformIsWeb);
  const [view, setView] = useState<SelectorView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);

  // Only a *selectable* roster (one that renders the personalities section)
  // changes the view layout. A read-only identity roster — passed with a
  // selected id but no onSelectPersonality, as the running-agent controls do to
  // label the trigger — must not suppress the single-provider bypass.
  const hasPersonalities = (personalities?.length ?? 0) > 0 && Boolean(onSelectPersonality);

  // Single-provider mode: only one provider → skip Level 1 entirely and open
  // straight into that family. The family view carries its own personalities
  // section (see SelectorContent), so a locked-in roster no longer forces the
  // "all" view — a running chat agent lands directly on its family's models +
  // same-family personalities.
  const singleProviderView = useMemo<SelectorView | null>(() => {
    if (providers.length !== 1) return null;
    const provider = providers[0];
    if (!provider) return null;
    return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
  }, [providers]);

  const computeInitialView = useCallback((): SelectorView => {
    if (singleProviderView) return singleProviderView;

    // A selected personality lives in the "all" view — open there so it (and the
    // rest of the roster) shows up front, rather than drilling into the model
    // family of the personality's underlying provider/model.
    if (hasPersonalities && selectedPersonalityId) return { kind: "all" };

    const selectedFavoriteKey = `${selectedProvider}:${selectedModel}`;
    if (selectedProvider && selectedModel && !favoriteKeys.has(selectedFavoriteKey)) {
      const provider = providers.find((entry) => entry.id === selectedProvider);
      if (provider)
        return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
    }

    return { kind: "all" };
  }, [
    singleProviderView,
    hasPersonalities,
    selectedPersonalityId,
    selectedProvider,
    selectedModel,
    favoriteKeys,
    providers,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      setView(computeInitialView());
      if (open) {
        onOpen?.();
      } else {
        setSearchQuery("");
        bumpSearchResetKey();
        onClose?.();
      }
    },
    [onOpen, onClose, computeInitialView],
  );

  const handleSelect = useCallback(
    (provider: string, modelId: string) => {
      // Explicitly picking a model switches away from a bound personality — the
      // raw model becomes the identity. (Deviating effort/mode elsewhere keeps
      // the personality; only a direct model pick here clears it.) Running
      // agents pass onSelectModelOverPersonality so both halves ride one
      // confirmed RPC flow; draft surfaces fall back to onSelect + client-side
      // clear. A read-only identity roster (old daemons) passes neither
      // handler, so the pick is a plain model change.
      if (selectedPersonalityId && onSelectModelOverPersonality) {
        onSelectModelOverPersonality(provider, modelId);
      } else {
        onSelect(provider, modelId);
        if (selectedPersonalityId) {
          onClearPersonality?.();
        }
      }
      setIsOpen(false);
      setSearchQuery("");
      bumpSearchResetKey();
    },
    [onSelect, onClearPersonality, onSelectModelOverPersonality, selectedPersonalityId],
  );

  // Undefined when the caller passed no handler (read-only identity roster) so
  // PersonalitiesSection's !onSelectPersonality guard actually fires and the
  // roster rows stay hidden — the entries then only label the trigger.
  const handlePersonalitySelect = useMemo(
    () =>
      onSelectPersonality
        ? (id: string) => {
            onSelectPersonality(id);
            setIsOpen(false);
            setSearchQuery("");
            bumpSearchResetKey();
          }
        : undefined,
    [onSelectPersonality],
  );

  const handlePersonalityClear = useMemo(
    () =>
      onClearPersonality
        ? () => {
            onClearPersonality();
            setIsOpen(false);
            setSearchQuery("");
            bumpSearchResetKey();
          }
        : undefined,
    [onClearPersonality],
  );

  const hasSelectedProvider = selectedProvider.trim().length > 0;

  // A selected personality owns the trigger's identity — its name and spinner
  // glow stand in for the raw model label/provider glyph, so the composer chip
  // reads "Atlas" (with its blob) instead of "Fable 5". Deviating the model by
  // hand keeps the personality selected, so this stays sticky through overrides.
  const selectedPersonality = useMemo(
    () =>
      selectedPersonalityId
        ? (personalities?.find((entry) => entry.id === selectedPersonalityId) ?? null)
        : null,
    [personalities, selectedPersonalityId],
  );

  const selectedModelLabel = useMemo(() => {
    return resolveSelectedModelLabel({
      providers,
      selectedProvider,
      selectedModel,
      isLoading,
    });
  }, [isLoading, providers, selectedModel, selectedProvider]);

  const desktopFixedHeight = useMemo(() => {
    if (view.kind !== "provider") {
      return undefined;
    }
    const familyPersonalityCount = onSelectPersonality
      ? (personalities?.filter((entry) => entry.provider === view.providerId).length ?? 0)
      : 0;
    const personalityHeight =
      familyPersonalityCount > 0
        ? DESKTOP_PERSONALITY_HEADING_HEIGHT +
          familyPersonalityCount * DESKTOP_PERSONALITY_ROW_HEIGHT
        : 0;
    const provider = providers.find((entry) => entry.id === view.providerId);
    if (!provider || provider.modelSelection.kind !== "models") {
      return DESKTOP_PROVIDER_VIEW_MIN_HEIGHT;
    }
    const modelCount = getProviderModelRows(provider).length;
    return Math.min(
      Math.max(
        DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
        DESKTOP_PROVIDER_VIEW_BASE_HEIGHT +
          modelCount * DESKTOP_MODEL_ROW_HEIGHT +
          personalityHeight,
      ),
      DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
    );
  }, [providers, view, personalities, onSelectPersonality]);

  const triggerLabel = useMemo(() => {
    if (selectedPersonality) {
      return selectedPersonality.name;
    }

    if (
      selectedModelLabel === t("modelSelector.loading") ||
      selectedModelLabel === t("modelSelector.selectModel")
    ) {
      return selectedModelLabel;
    }

    return buildSelectedTriggerLabel(selectedModelLabel);
  }, [selectedModelLabel, selectedPersonality, t]);

  useEffect(() => {
    if (platformIsWeb) {
      return () => {};
    }

    if (!isOpen) {
      setIsContentReady(false);
      return () => {};
    }

    const frame = requestAnimationFrame(() => {
      setIsContentReady(true);
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleTriggerPress = useCallback(() => {
    handleOpenChange(!isOpen);
  }, [handleOpenChange, isOpen]);

  const triggerStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      // Fill mode: transparent full-width passthrough. The trigger paints its own
      // hover/pressed state from the args, so the wrapper must not double-paint.
      if (triggerFill) {
        return [
          styles.trigger,
          styles.customTriggerWrapper,
          styles.triggerFill,
          disabled && styles.triggerDisabled,
        ];
      }
      return [
        styles.trigger,
        Boolean(hovered) && styles.triggerHovered,
        (pressed || isOpen) && styles.triggerPressed,
        disabled && styles.triggerDisabled,
        renderTrigger ? styles.customTriggerWrapper : null,
      ];
    },
    [disabled, isOpen, renderTrigger, triggerFill],
  );

  const handleBackToAll = useCallback(() => {
    setView({ kind: "all" });
    setSearchQuery("");
    bumpSearchResetKey();
  }, []);

  const handleDrillDown = useCallback((providerId: string, providerLabel: string) => {
    setView({ kind: "provider", providerId, providerLabel });
  }, []);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const openProviderSettings = useCallback(() => {
    if (!serverId || view.kind !== "provider") return;
    useProviderSettingsStore.getState().open({ serverId, provider: view.providerId });
  }, [serverId, view]);

  const sheetHeader = useMemo<SheetHeader>(() => {
    if (view.kind === "all") {
      return { title: t("modelSelector.title") };
    }
    const headerActions = (
      <Pressable
        onPress={openProviderSettings}
        disabled={!serverId}
        hitSlop={8}
        style={iconButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("modelSelector.openProviderSettings", {
          provider: view.providerLabel,
        })}
        testID={`selector-header-settings-${view.providerId}`}
      >
        <HeaderSettingsIcon disabled={!serverId} />
      </Pressable>
    );
    return {
      title: view.providerLabel,
      leading: <ProviderGlyph provider={view.providerId} size={ICON_SIZE.md} tone="foreground" />,
      back: singleProviderView ? undefined : { onPress: handleBackToAll },
      actions: headerActions,
      search: {
        onChange: handleSearchQueryChange,
        resetKey: `${view.providerId}:${searchResetKey}`,
        placeholder: t("modelSelector.searchPlaceholder"),
        autoFocus: platformIsWeb,
        testID: "model-search-input",
      },
    };
  }, [
    view,
    singleProviderView,
    serverId,
    openProviderSettings,
    handleBackToAll,
    handleSearchQueryChange,
    searchResetKey,
    t,
  ]);

  return (
    <>
      {renderTrigger ? (
        <Pressable
          ref={anchorRef}
          collapsable={false}
          disabled={disabled}
          onPress={handleTriggerPress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={t("modelSelector.selectedModel", { model: selectedModelLabel })}
          testID="combined-model-selector"
        >
          {({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
            renderTrigger({
              selectedModelLabel: triggerLabel,
              onPress: handleTriggerPress,
              disabled,
              isOpen,
              hovered: Boolean(hovered),
              pressed,
            })
          }
        </Pressable>
      ) : (
        <ComboboxTrigger
          ref={anchorRef}
          collapsable={false}
          disabled={disabled}
          onPress={handleTriggerPress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={t("modelSelector.selectedModel", { model: selectedModelLabel })}
          testID="combined-model-selector"
        >
          {triggerLoading ? (
            <ThemedLoadingSpinner size={iconSize.md} uniProps={foregroundMutedMapping} />
          ) : (
            <TriggerLeadingIcon
              personality={selectedPersonality}
              provider={hasSelectedProvider ? selectedProvider : null}
              size={iconSize.md}
            />
          )}
          <Text style={styles.triggerText} numberOfLines={1} ellipsizeMode="tail">
            {triggerLabel}
          </Text>
        </ComboboxTrigger>
      )}
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
        desktopFixedHeight={desktopFixedHeight}
        header={sheetHeader}
        mobileChildrenScrollEnabled={view.kind !== "provider" || !isNative}
      >
        {isContentReady ? (
          <SelectorContent
            view={view}
            providers={providers}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            searchQuery={searchQuery}
            favoriteKeys={favoriteKeys}
            onSelect={handleSelect}
            onToggleFavorite={onToggleFavorite}
            onDrillDown={handleDrillDown}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
            personalities={personalities}
            selectedPersonalityId={selectedPersonalityId}
            onSelectPersonality={handlePersonalitySelect}
            onClearPersonality={handlePersonalityClear}
          />
        ) : (
          <View style={styles.sheetLoadingState}>
            <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
            <Text style={styles.sheetLoadingText}>{t("modelSelector.loadingSelector")}</Text>
          </View>
        )}
      </Combobox>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Geometry mirrors the composer's mode/effort chips (mode-control `chip`,
  // agent-controls `modeBadge`) — all three sit in the same toolbar row and
  // must scale together on compact breakpoints.
  trigger: {
    height: compactUp(28),
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius["2xl"],
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface0,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  customTriggerWrapper: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    height: "auto",
    // The only non-fill custom trigger is the composer's icon-only badge; the
    // wrapper paints its hover/pressed state, so it must be circular to match
    // the other icon badges in the toolbar (triggerFill zeroes this back out).
    borderRadius: theme.borderRadius.full,
  },
  // Stretch the wrapper (and, via column + stretch, its single child) to the
  // full width of the field, with no background or rounding of its own.
  triggerFill: {
    alignSelf: "stretch",
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  favoritesContainer: {
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  personalitiesContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  personalityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 44,
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  personalityRowDisabled: {
    opacity: 0.5,
  },
  personalityText: {
    flex: 1,
    minWidth: 0,
  },
  personalityName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  personalitySubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  sectionHeadingText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  drillDownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 36,
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  drillDownRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  drillDownRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  drillDownText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
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
  rowErrorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    maxWidth: 140,
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
    backgroundColor: theme.colors.surfaceHover,
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
  virtualizedModelList: {
    flex: 1,
  },
  virtualizedModelListContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[8],
  },
  favoriteButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  favoriteButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  favoriteButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  sheetLoadingState: {
    minHeight: 160,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sheetLoadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerIconMuted: {
    color: theme.colors.foregroundMuted,
  },
  providerIconForeground: {
    color: theme.colors.foreground,
  },
}));
