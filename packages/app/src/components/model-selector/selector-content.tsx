import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb as platformIsWeb } from "@/constants/platform";
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronRight,
  type IconComponent,
  Search,
  Settings,
  Star,
  StarFilled,
} from "@/components/icons/material-icons";
import {
  BrainModelFamilyIcon,
  hasBrainModelFamilyIcon,
} from "@/components/brain/brain-model-family-icon";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { ComboboxItem } from "@/components/ui/combobox";
import { getProviderIcon } from "@/components/provider-icons";
import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  presentProviderModelSelectionError,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import type { IconSizeProp } from "@/components/icons/icon-size";

/**
 * The Otto model/personality selector implementation: the drill-down views,
 * favorites, personality sections and role groups that CombinedModelSelector
 * renders. Otto-only code, so it lives in its own module; Paseo's
 * combined-model-selector.tsx keeps the trigger shell and composes this.
 */

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function noop() {}

const IS_WEB = platformIsWeb;
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
export const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
export const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
export const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
// Dense rows (single-line, reduced padding) so more of the list fits on
// screen - mirror the `dense` ComboboxItem / personalityRow desktop heights.
export const DESKTOP_MODEL_ROW_HEIGHT = 30;
export const DESKTOP_PERSONALITY_ROW_HEIGHT = 30;
export const DESKTOP_PERSONALITY_HEADING_HEIGHT = 28;
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
export const ThemedBoxes = withUnistyles(Boxes);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedSearch = withUnistyles(Search);
const ThemedSettings = withUnistyles(Settings);
const ThemedStar = withUnistyles(Star);
const ThemedStarFilled = withUnistyles(StarFilled);
const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });
export const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * Presentation view-model for a personality row in the picker. The selector is
 * pure presentation - callers (via usePersonalitySelection) build these,
 * including availability, so the component never touches daemon config.
 */
export interface SelectorProfile {
  id: string;
  name: string;
  /** Provider id - picks the glyph filled with the personality's gradient. */
  provider: string;
  subtitle: string;
  glowA?: string;
  glowB?: string;
  available: boolean;
  unavailableReason?: string;
  /**
   * A neutral leading glyph that REPLACES the colored provider icon - used by
   * the synthetic "Team's <Role>" entry, whose concrete holder changes with the
   * active team, so wearing any one personality's provider glyph would mislead.
   * A plain role icon makes clear you're picking a role, not that personality.
   */
  roleIcon?: IconComponent;
}

/** One role's personalities inside a grouped browse section. */
export interface SelectorProfileRoleGroup {
  /** Role id (or "none" for roleless personalities) - stable list key. */
  key: string;
  /** Human role label, e.g. "Coder". */
  label: string;
  /** Neutral role glyph for the sub-heading. */
  icon?: IconComponent;
  personalities: SelectorProfile[];
}

/**
 * A collapsible top-level group in the "browse all profiles" section of
 * the picker: the active team (label = team name) and/or the rest of the
 * roster, each broken down by role. Built by the caller (the picker stays pure
 * presentation); a multi-role personality appears under each role it carries.
 */
export interface SelectorProfileGroupSection {
  /** Section key ("team" | "others" | "all") - stable list key. */
  key: string;
  /** Section header label, e.g. the team name or "All profiles". */
  label: string;
  roleGroups: SelectorProfileRoleGroup[];
}
const headerSettingsMapping = (disabled: boolean) => (theme: Theme) => ({
  color: disabled ? theme.colors.border : theme.colors.foregroundMuted,
});

// Material Symbols have no `fill` prop - the filled state swaps to the
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
export function ProviderGlyph({
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

/**
 * Leading glyph for the selector trigger. With a selected personality that
 * carries both spinner colors, the provider icon is filled with those colors as
 * a static 45° gradient (identity without an animated spinner); otherwise the
 * plain provider glyph - except a Brain model, which wears its catalog family
 * mark under the same rule as ModelRowGlyph. Nothing when there is no provider.
 */
export function TriggerLeadingIcon({
  personality,
  provider,
  family,
  size,
}: {
  personality: SelectorProfile | null;
  provider: string | null;
  family?: string | null;
  size: IconSizeProp;
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
  if (provider === "otto-brain" && hasBrainModelFamilyIcon(family)) {
    return (
      <BrainModelFamilyIcon family={family} size={size} color={styles.providerIconMuted.color} />
    );
  }
  return <ProviderGlyph provider={provider} size={size} />;
}
export function HeaderSettingsIcon({ disabled }: { disabled: boolean }) {
  const uniProps = useMemo(() => headerSettingsMapping(disabled), [disabled]);
  return <ThemedSettings size="sm" uniProps={uniProps} />;
}
function FavoriteStar({ isFavorite, hovered }: { isFavorite: boolean; hovered: boolean }) {
  const uniProps = useMemo(() => favoriteStarMapping(isFavorite, hovered), [hovered, isFavorite]);
  const ThemedIcon = isFavorite ? ThemedStarFilled : ThemedStar;
  return <ThemedIcon size="md" uniProps={uniProps} />;
}
export type SelectorView =
  | { kind: "all" }
  | { kind: "provider"; providerId: string; providerLabel: string }
  | { kind: "personalityGroup"; sectionKey: string; sectionLabel: string };
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
  onDrillDownPersonalityGroup: (sectionKey: string, sectionLabel: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
  personalities?: SelectorProfile[];
  profileSectionLabel?: string;
  profileGroups?: SelectorProfileGroupSection[];
  selectedProfileId?: string | null;
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
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
/**
 * Otto Brain serves models from many vendors, so a row of them all wearing the
 * Brain glyph says nothing about which model it is. Brain rows carry a
 * catalog-owned family, and that family's brand mark is the useful mark. Rows
 * from any other provider - and Brain families the catalog has no mark for -
 * keep the provider glyph.
 */
function ModelRowGlyph({ provider, family }: { provider: string; family?: string }) {
  if (provider === "otto-brain" && hasBrainModelFamilyIcon(family)) {
    return (
      <BrainModelFamilyIcon family={family} size="sm" color={styles.providerIconMuted.color} />
    );
  }
  return <ProviderGlyph provider={provider} size="sm" />;
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
    () => <ModelRowGlyph provider={row.provider} family={row.family} />,
    [row.provider, row.family],
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
      dense
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingAction={trailingSlot}
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
export function iconButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
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
          <ThemedLoadingSpinner size="sm" uniProps={foregroundMutedMapping} />
        </View>
        <Text style={styles.drillDownCount}>{t("modelSelector.loadingShort")}</Text>
      </View>
    );
  } else {
    stateNode = (
      <View style={styles.rowStateInline}>
        <ThemedAlertTriangle size="sm" uniProps={foregroundMutedMapping} />
        <Text style={styles.drillDownCount}>{t("modelSelector.error")}</Text>
      </View>
    );
  }

  return (
    <Pressable onPress={handlePress} style={drillDownRowStyle}>
      <ProviderGlyph provider={provider.id} size="sm" />
      <Text style={styles.drillDownText}>{provider.label}</Text>
      <View style={styles.drillDownTrailing}>
        {stateNode}
        <ThemedChevronRight size="sm" uniProps={foregroundMutedMapping} />
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
      <FlatList
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

// A role-slot entry (Team's <Role>) shows a neutral role glyph so it reads as
// picking a role; a concrete personality keeps its colored provider glyph.
function PersonalityRowIcon({ personality }: { personality: SelectorProfile }) {
  if (personality.roleIcon) {
    const RoleIcon = personality.roleIcon;
    return <RoleIcon size="md" color={styles.providerIconForeground.color} />;
  }
  return (
    <PersonalityProviderIcon
      provider={personality.provider}
      size="md"
      glowA={personality.glowA}
      glowB={personality.glowB}
    />
  );
}
function PersonalityRow({
  personality,
  isSelected,
  indent = false,
  onSelect,
  onClear,
}: {
  personality: SelectorProfile;
  isSelected: boolean;
  /** Nested under a role sub-heading in the grouped section. */
  indent?: boolean;
  onSelect: (id: string) => void;
  /**
   * Press-the-selected-row-to-detach. Only the up-front Personalities section
   * passes it - there the row IS the current binding, so toggling it off is the
   * explicit "clear personality" affordance (the running-agent picker's only
   * one). The grouped browse panel deliberately omits it: that panel is a
   * roster directory, and pressing a name there means "run as this personality",
   * never "drop back to the raw model".
   */
  onClear?: () => void;
}) {
  const handlePress = useCallback(() => {
    if (!personality.available) return;
    if (isSelected && onClear) {
      onClear();
      return;
    }
    onSelect(personality.id);
  }, [personality.available, personality.id, isSelected, onSelect, onClear]);

  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.personalityRow,
      indent && styles.personalityRowIndented,
      Boolean(hovered) && personality.available && styles.drillDownRowHovered,
      pressed && personality.available && styles.drillDownRowPressed,
      !personality.available && styles.personalityRowDisabled,
    ],
    [personality.available, indent],
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
      {isSelected ? <ThemedCheck size="sm" uniProps={accentMapping} /> : null}
    </Pressable>
  );
}
export function PersonalitiesSection({
  personalities,
  label = "Agent profiles",
  selectedProfileId,
  onSelectProfile,
  onClearProfile,
}: {
  personalities?: SelectorProfile[];
  label?: string;
  selectedProfileId?: string | null;
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
}) {
  if (!personalities || personalities.length === 0 || !onSelectProfile) {
    return null;
  }
  const handleClear = onClearProfile ?? noop;
  return (
    <View style={styles.personalitiesContainer}>
      <View style={styles.sectionHeading}>
        {/* i18n: English-only pending the agent-personalities translation pass. */}
        <Text style={styles.sectionHeadingText}>{label}</Text>
      </View>
      {personalities.map((personality) => (
        <PersonalityRow
          key={personality.id}
          personality={personality}
          isSelected={personality.id === selectedProfileId}
          onSelect={onSelectProfile}
          onClear={handleClear}
        />
      ))}
    </View>
  );
}
function RoleGroupIcon({ icon: Icon }: { icon: IconComponent }) {
  return <Icon size="sm" color={styles.providerIconMuted.color} />;
}

/** Distinct personalities across a section's role groups (a multi-role
 * personality shows under each role it carries but counts once here). */
function countDistinctPersonalities(section: SelectorProfileGroupSection): number {
  const ids = new Set<string>();
  for (const group of section.roleGroups) {
    for (const personality of group.personalities) {
      ids.add(personality.id);
    }
  }
  return ids.size;
}

/**
 * Keep the role groups (and, within them, the personalities) that survive a
 * search query. A query matching a role label keeps that whole group; otherwise
 * it filters the group's personalities by name. Empty query keeps everything.
 */
function filterPersonalityRoleGroups(
  section: SelectorProfileGroupSection,
  normalizedQuery: string,
): SelectorProfileRoleGroup[] {
  if (!normalizedQuery) {
    return section.roleGroups;
  }
  const result: SelectorProfileRoleGroup[] = [];
  for (const group of section.roleGroups) {
    const roleMatches = group.label.toLowerCase().includes(normalizedQuery);
    const personalities = roleMatches
      ? group.personalities
      : group.personalities.filter((entry) => entry.name.toLowerCase().includes(normalizedQuery));
    if (personalities.length > 0) {
      result.push({ ...group, personalities });
    }
  }
  return result;
}

/**
 * One drill-down row for a personality group section (the active team, or "All
 * personalities"). Mirrors GroupProviderButton: a leading glyph, the section
 * label, the distinct-personality count, and a chevron opening the second
 * panel - where the section's roles and personalities are browsed/searched.
 */
function PersonalityGroupButton({
  section,
  onDrillDown,
}: {
  section: SelectorProfileGroupSection;
  onDrillDown: (sectionKey: string, sectionLabel: string) => void;
}) {
  const handlePress = useCallback(
    () => onDrillDown(section.key, section.label),
    [onDrillDown, section.key, section.label],
  );
  const count = useMemo(() => countDistinctPersonalities(section), [section]);
  return (
    <Pressable
      onPress={handlePress}
      style={drillDownRowStyle}
      accessibilityRole="button"
      testID={`personality-group-${section.key}`}
    >
      <ThemedBoxes size="sm" uniProps={foregroundMutedMapping} />
      <Text style={styles.drillDownText}>{section.label}</Text>
      <View style={styles.drillDownTrailing}>
        {/* i18n: English-only pending the agent-personalities translation pass. */}
        <Text style={styles.drillDownCount}>{count === 1 ? "1 profile" : `${count} profiles`}</Text>
        <ThemedChevronRight size="sm" uniProps={foregroundMutedMapping} />
      </View>
    </Pressable>
  );
}

/**
 * The "browse everyone" section, now a set of drill-down rows (one per group:
 * active team first, then the rest of the roster - or a single "All
 * personalities" row). Each opens a second panel (like a provider family) with
 * its own search over roles and personalities, so ANY personality is reachable
 * without the picker ballooning inline.
 */
function PersonalityGroupsSection({
  groups,
  onDrillDownPersonalityGroup,
  onSelectProfile,
}: {
  groups?: SelectorProfileGroupSection[];
  onDrillDownPersonalityGroup: (sectionKey: string, sectionLabel: string) => void;
  onSelectProfile?: (id: string) => void;
}) {
  if (!groups || groups.length === 0 || !onSelectProfile) {
    return null;
  }
  return (
    <View style={styles.personalitiesContainer}>
      {groups.map((section, index) => (
        <View key={section.key}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <PersonalityGroupButton section={section} onDrillDown={onDrillDownPersonalityGroup} />
        </View>
      ))}
    </View>
  );
}

/**
 * Second-panel body for a drilled-in personality group: role sub-headings with
 * their personalities, already filtered by the header search. Selection flows
 * through the same handlers as everywhere else.
 */
function PersonalityGroupRoleGroups({
  roleGroups,
  selectedProfileId,
  onSelectProfile,
}: {
  roleGroups: SelectorProfileRoleGroup[];
  selectedProfileId?: string | null;
  onSelectProfile: (id: string) => void;
}) {
  return (
    <View style={styles.personalitiesContainer}>
      {roleGroups.map((group) => (
        <View key={group.key}>
          <View style={styles.roleGroupHeading}>
            {group.icon ? <RoleGroupIcon icon={group.icon} /> : null}
            <Text style={styles.sectionHeadingText}>{group.label}</Text>
          </View>
          {group.personalities.map((personality) => (
            <PersonalityRow
              key={`${group.key}-${personality.id}`}
              personality={personality}
              isSelected={personality.id === selectedProfileId}
              indent
              onSelect={onSelectProfile}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The drilled-in personality-group panel: resolves the section, applies the
 * header search over its roles/personalities, and renders the role groups (or a
 * "no matches" empty state). Extracted so SelectorContent stays a thin router.
 */
function PersonalityGroupContent({
  sectionKey,
  normalizedQuery,
  profileGroups,
  selectedProfileId,
  onSelectProfile,
}: {
  sectionKey: string;
  normalizedQuery: string;
  profileGroups?: SelectorProfileGroupSection[];
  selectedProfileId?: string | null;
  onSelectProfile?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const section = profileGroups?.find((entry) => entry.key === sectionKey);
  const roleGroups = useMemo(
    () => (section ? filterPersonalityRoleGroups(section, normalizedQuery) : []),
    [section, normalizedQuery],
  );
  if (!section || !onSelectProfile || roleGroups.length === 0) {
    return (
      <View style={styles.emptyState}>
        <ThemedSearch size="md" uniProps={foregroundMutedMapping} />
        <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
      </View>
    );
  }
  return (
    <PersonalityGroupRoleGroups
      roleGroups={roleGroups}
      selectedProfileId={selectedProfileId}
      onSelectProfile={onSelectProfile}
    />
  );
}
export function SelectorContent({
  view,
  providers,
  selectedProvider,
  selectedModel,
  searchQuery,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  onDrillDown,
  onDrillDownPersonalityGroup,
  onRetryProvider,
  isRetryingProvider,
  personalities,
  profileSectionLabel,
  profileGroups,
  selectedProfileId,
  onSelectProfile,
  onClearProfile,
}: SelectorContentProps) {
  const { t } = useTranslation();
  // Only the mobile-native provider view virtualizes its model list, and only
  // that path wants a flex-bounded body (see providerViewBody). Everywhere else
  // the body sits inside a ScrollView whose content height is auto, where
  // `flex: 1` resolves against zero free space and collapses the list.
  const usesVirtualizedModelList = useIsCompactFormFactor() && isNative;
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
  const emptyState = (
    <View style={styles.emptyState}>
      <ThemedSearch size="md" uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
    </View>
  );

  if (view.kind === "personalityGroup") {
    return (
      <PersonalityGroupContent
        sectionKey={view.sectionKey}
        normalizedQuery={normalizedQuery}
        profileGroups={profileGroups}
        selectedProfileId={selectedProfileId}
        onSelectProfile={onSelectProfile}
      />
    );
  }

  if (view.kind === "provider") {
    if (!selectedViewProvider) {
      return emptyState;
    }
    // Personalities that belong to this family, pinned above the model list so a
    // family menu (including a locked running chat agent's) lets you pick one of
    // its personalities as readily as a raw model. The search box filters these by
    // name alongside the models. Renders nothing when the roster is read-only (no
    // onSelectProfile) or has none matching for this family.
    const familyPersonalities = personalities?.filter(
      (entry) =>
        entry.provider === view.providerId &&
        (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)),
    );
    const familyPersonalitiesNode = (
      <PersonalitiesSection
        personalities={familyPersonalities}
        label={profileSectionLabel}
        selectedProfileId={selectedProfileId}
        onSelectProfile={onSelectProfile}
        onClearProfile={onClearProfile}
      />
    );
    const drillSelection = selectedViewProvider.modelSelection;
    if (drillSelection.kind === "loading") {
      return (
        <View>
          {familyPersonalitiesNode}
          <View style={styles.emptyState}>
            <View style={styles.rowSpinner}>
              <ThemedLoadingSpinner size="sm" uniProps={foregroundMutedMapping} />
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
            providerLabel={view.providerLabel}
            message={drillSelection.message}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
          />
        </View>
      );
    }

    // Only fall back to "no matches" when nothing - models or personalities -
    // survived the filter, so a personality-only match doesn't read as empty.
    const hasFamilyPersonalityMatch =
      Boolean(onSelectProfile) && (familyPersonalities?.length ?? 0) > 0;
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
      <View style={usesVirtualizedModelList ? styles.providerViewBody : undefined}>
        {familyPersonalitiesNode}
        {modelBody}
      </View>
    );
  }

  return (
    <AllViewContent
      providers={providers}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      favoriteKeys={favoriteKeys}
      onSelect={onSelect}
      onToggleFavorite={onToggleFavorite}
      onDrillDown={onDrillDown}
      onDrillDownPersonalityGroup={onDrillDownPersonalityGroup}
      personalities={personalities}
      profileSectionLabel={profileSectionLabel}
      profileGroups={profileGroups}
      selectedProfileId={selectedProfileId}
      onSelectProfile={onSelectProfile}
      onClearProfile={onClearProfile}
    />
  );
}

/**
 * Level-1 "all" view: the up-front (surface-role) personalities, the personality
 * group drill-down rows, favorites, and the provider families. Extracted so
 * SelectorContent stays a thin view router under the complexity budget.
 */
function AllViewContent({
  providers,
  selectedProvider,
  selectedModel,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  onDrillDown,
  onDrillDownPersonalityGroup,
  personalities,
  profileSectionLabel,
  profileGroups,
  selectedProfileId,
  onSelectProfile,
  onClearProfile,
}: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  favoriteKeys: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  onDrillDownPersonalityGroup: (sectionKey: string, sectionLabel: string) => void;
  personalities?: SelectorProfile[];
  profileSectionLabel?: string;
  profileGroups?: SelectorProfileGroupSection[];
  selectedProfileId?: string | null;
  onSelectProfile?: (id: string) => void;
  onClearProfile?: () => void;
}) {
  const { t } = useTranslation();
  const favoriteRows = useMemo(
    () => getAllProviderModelRows(providers).filter((row) => favoriteKeys.has(row.favoriteKey)),
    [favoriteKeys, providers],
  );
  const hasResults =
    favoriteRows.length > 0 ||
    providers.length > 0 ||
    (personalities?.length ?? 0) > 0 ||
    (profileGroups?.length ?? 0) > 0;
  return (
    <View>
      <PersonalitiesSection
        personalities={personalities}
        label={profileSectionLabel}
        selectedProfileId={selectedProfileId}
        onSelectProfile={onSelectProfile}
        onClearProfile={onClearProfile}
      />

      <PersonalityGroupsSection
        groups={profileGroups}
        onDrillDownPersonalityGroup={onDrillDownPersonalityGroup}
        onSelectProfile={onSelectProfile}
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

      {!hasResults ? (
        <View style={styles.emptyState}>
          <ThemedSearch size="md" uniProps={foregroundMutedMapping} />
          <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  favoritesContainer: {
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  personalitiesContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // Dense single-line personality row: name + subtitle share one baseline row
  // (mirroring ComboboxItem's inline description) so the picker fits far more
  // entries on screen than the old stacked two-line layout. Compact keeps a
  // 40px minimum so rows stay comfortably tappable on mobile.
  personalityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: {
      xs: 40,
      md: 30,
    },
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  personalityRowIndented: {
    paddingLeft: theme.spacing[6],
  },
  personalityRowDisabled: {
    opacity: 0.5,
  },
  personalityText: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  personalityName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  personalitySubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  roleGroupHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: 2,
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
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
    // Dense on desktop; compact keeps the kit's touch-friendly height.
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[1],
    },
    minHeight: {
      xs: 36,
      md: 30,
    },
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
  // The mobile-native provider view renders straight into the sheet's
  // flex-bounded frame (no wrapping ScrollView - see mobileChildrenScrollEnabled
  // in Combobox) so its virtualized FlatList can measure a real height. Without
  // flex here this View auto-sizes to content, the FlatList's flex: 1 has
  // nothing to fill, and the model list silently renders as zero height. Applied
  // on that path only - see usesVirtualizedModelList in SelectorContent.
  providerViewBody: {
    flex: 1,
    minHeight: 0,
  },
  virtualizedModelList: {
    flex: 1,
  },
  virtualizedModelListContent: {
    // Model rows and Agent Profile rows share the sheet's leading rail. The
    // FlatList is native-only, so giving its content an extra inset shifted
    // every model glyph and label beyond the profiles above it.
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
  providerIconMuted: {
    color: theme.colors.foregroundMuted,
  },
  providerIconForeground: {
    color: theme.colors.foreground,
  },
}));
