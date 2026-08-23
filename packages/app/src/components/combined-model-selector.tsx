import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isNative, isWeb as platformIsWeb } from "@/constants/platform";
import type { AgentProfilePicker } from "@/agent-profiles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { compactUp, ICON_SIZE, type Theme } from "@/styles/theme";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import {
  buildSelectedTriggerLabel,
  getProviderModelRows,
  resolveSelectedModelLabel,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  DESKTOP_MODEL_ROW_HEIGHT,
  DESKTOP_PERSONALITY_HEADING_HEIGHT,
  DESKTOP_PERSONALITY_ROW_HEIGHT,
  DESKTOP_PROVIDER_VIEW_BASE_HEIGHT,
  DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
  DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
  HeaderSettingsIcon,
  ProviderGlyph,
  SelectorContent,
  ThemedBoxes,
  TriggerLeadingIcon,
  foregroundMapping,
  iconButtonStyle,
} from "./model-selector/selector-content";
import type {
  SelectorPersonality,
  SelectorPersonalityGroupSection,
  SelectorView,
} from "./model-selector/selector-content";
const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];
const EMPTY_FAVORITE_KEYS = new Set<string>();

function noop() {}
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface CombinedModelSelectorProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: AgentProvider, modelId: string) => void;
  isLoading: boolean;
  favoriteKeys?: Set<string>;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  profiles?: AgentProfilePicker | null;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
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
  /**
   * Optional grouped roster - every personality organized by team and role,
   * rendered as collapsible groups below the up-front section so any
   * personality (not just this surface's role) is reachable in a couple of
   * taps. Selection flows through the same onSelectPersonality handler.
   * Empty/undefined hides the grouped section entirely.
   */
  personalityGroups?: SelectorPersonalityGroupSection[];
  selectedPersonalityId?: string | null;
  onSelectPersonality?: (id: string) => void;
  onClearPersonality?: () => void;
  /**
   * Picking a raw model while a personality is selected. When provided, the
   * picker routes the model pick here INSTEAD of onSelect+onClearPersonality -
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
   * Replace the default trigger's leading glyph with a spinner - a live
   * personality switch is applying on the daemon. The compact icon-only custom
   * trigger renders its own spinner (renderTrigger bypasses this).
   */
  triggerLoading?: boolean;
}

export function CombinedModelSelector({
  providers,
  selectedProvider,
  selectedModel,
  onSelect,
  isLoading,
  favoriteKeys = EMPTY_FAVORITE_KEYS,
  onToggleFavorite,
  profiles = null,
  onApplyProfile,
  onEditProfiles,
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
  personalityGroups,
  selectedPersonalityId = null,
  onSelectPersonality,
  onClearPersonality,
  onSelectModelOverPersonality,
  triggerFill = false,
  triggerLoading = false,
}: CombinedModelSelectorProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  // Live icon size - the static ICON_SIZE import never sees the compact
  // doubling, which would leave this trigger's glyph half the size of the
  // neighboring mode/effort chip icons on compact breakpoints.
  const [isOpen, setIsOpen] = useState(false);
  const [isContentReady, setIsContentReady] = useState(platformIsWeb);
  const [view, setView] = useState<SelectorView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);

  const profileRows = useMemo<SelectorPersonality[]>(
    () =>
      (profiles?.rows ?? []).map((profile) => ({
        id: `profile:${profile.id}`,
        name: profile.name,
        provider: profile.provider,
        subtitle: profile.summary,
        glowA: profile.color || undefined,
        glowB: profile.color || undefined,
        available: true,
      })),
    [profiles],
  );
  const selectableIdentities = useMemo(
    () => [...profileRows, ...(personalities ?? [])],
    [personalities, profileRows],
  );

  // Only a *selectable* roster (one that renders the identities section)
  // changes the view layout. A read-only identity roster - passed with a
  // selected id but no onSelectPersonality, as the running-agent controls do to
  // label the trigger - must not suppress the single-provider bypass.
  const hasPersonalities =
    (selectableIdentities.length > 0 || (personalityGroups?.length ?? 0) > 0) &&
    Boolean(onSelectPersonality || onApplyProfile);

  // Providers in an error/unavailable state (auth failed, not installed,
  // unreachable) are hidden from the picker entirely. The one exception is the
  // CURRENT selection: its provider row stays visible (with the existing error
  // marker + retry in the drill-down) so the trigger and selection keep
  // rendering truthfully instead of vanishing or silently switching.
  const displayProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.modelSelection.kind !== "error" || provider.id === selectedProvider,
      ),
    [providers, selectedProvider],
  );

  // Single-provider mode: only one provider → skip Level 1 entirely and open
  // straight into that family. The family view carries its own personalities
  // section (see SelectorContent), so a locked-in roster no longer forces the
  // "all" view - a running chat agent lands directly on its family's models +
  // same-family personalities.
  const singleProviderView = useMemo<SelectorView | null>(() => {
    if (displayProviders.length !== 1) return null;
    const provider = displayProviders[0];
    if (!provider) return null;
    return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
  }, [displayProviders]);

  const computeInitialView = useCallback((): SelectorView => {
    if (singleProviderView) return singleProviderView;

    // A selectable personality roster (individual personalities and/or team
    // groups) lives in the "all" view. Always open there when one exists - even
    // with nothing selected yet - so the Personalities and Team groups are
    // visible up front, rather than drilling into the selected model's provider
    // family (which only surfaces that family's personalities and hides the
    // group headers until a personality happens to be selected).
    if (hasPersonalities) return { kind: "all" };

    const selectedFavoriteKey = `${selectedProvider}:${selectedModel}`;
    if (selectedProvider && selectedModel && !favoriteKeys.has(selectedFavoriteKey)) {
      const provider = displayProviders.find((entry) => entry.id === selectedProvider);
      if (provider)
        return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
    }

    return { kind: "all" };
  }, [
    singleProviderView,
    hasPersonalities,
    selectedProvider,
    selectedModel,
    favoriteKeys,
    displayProviders,
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
      // Explicitly picking a model switches away from a bound personality - the
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
  // roster rows stay hidden - the entries then only label the trigger.
  const handlePersonalitySelect = useMemo(
    () =>
      onSelectPersonality || onApplyProfile
        ? (id: string) => {
            if (id.startsWith("profile:")) {
              onApplyProfile?.(id.slice("profile:".length));
            } else {
              onSelectPersonality?.(id);
            }
            setIsOpen(false);
            setSearchQuery("");
            bumpSearchResetKey();
          }
        : undefined,
    [onApplyProfile, onSelectPersonality],
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

  // A selected personality owns the trigger's identity - its name and spinner
  // glow stand in for the raw model label/provider glyph, so the composer chip
  // reads "Atlas" (with its blob) instead of "Fable 5". Deviating the model by
  // hand keeps the personality selected, so this stays sticky through overrides.
  // The lookup falls through to the grouped roster - a personality picked from
  // a role group may not be in the up-front (surface-role) section.
  const selectedPersonality = useMemo(() => {
    if (!selectedPersonalityId) return null;
    const upFront = personalities?.find((entry) => entry.id === selectedPersonalityId);
    if (upFront) return upFront;
    for (const section of personalityGroups ?? []) {
      for (const group of section.roleGroups) {
        const match = group.personalities.find((entry) => entry.id === selectedPersonalityId);
        if (match) return match;
      }
    }
    return null;
  }, [personalities, personalityGroups, selectedPersonalityId]);

  const selectedModelLabel = useMemo(() => {
    return resolveSelectedModelLabel({
      providers,
      selectedProvider,
      selectedModel,
      isLoading,
    });
  }, [isLoading, providers, selectedModel, selectedProvider]);

  const desktopFixedHeight = useMemo(() => {
    if (view.kind === "personalityGroup") {
      const section = personalityGroups?.find((entry) => entry.key === view.sectionKey);
      if (!section) {
        return DESKTOP_PROVIDER_VIEW_MIN_HEIGHT;
      }
      // A multi-role personality renders once per role it carries, so the row
      // total is the sum across groups (not the distinct-personality count).
      let headingCount = 0;
      let rowCount = 0;
      for (const group of section.roleGroups) {
        headingCount += 1;
        rowCount += group.personalities.length;
      }
      return Math.min(
        Math.max(
          DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
          DESKTOP_PROVIDER_VIEW_BASE_HEIGHT +
            headingCount * DESKTOP_PERSONALITY_HEADING_HEIGHT +
            rowCount * DESKTOP_PERSONALITY_ROW_HEIGHT,
        ),
        DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
      );
    }
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
    const provider = displayProviders.find((entry) => entry.id === view.providerId);
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
  }, [displayProviders, view, personalities, personalityGroups, onSelectPersonality]);

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

  // Fill-mode form fields want the full width; the composer's toolbar chip caps
  // the label so a long model name ellipsizes instead of stretching the row.
  const triggerTextStyle = useMemo(
    () => (triggerFill ? styles.triggerText : [styles.triggerText, styles.triggerTextCapped]),
    [triggerFill],
  );

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

  const handleDrillDownPersonalityGroup = useCallback(
    (sectionKey: string, sectionLabel: string) => {
      setView({ kind: "personalityGroup", sectionKey, sectionLabel });
    },
    [],
  );

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const openProviderSettings = useCallback(() => {
    if (!serverId || view.kind !== "provider") return;
    useProviderSettingsStore.getState().open({ serverId, provider: view.providerId });
  }, [serverId, view]);

  const handleEditProfiles = useCallback(() => {
    handleOpenChange(false);
    onEditProfiles?.();
  }, [handleOpenChange, onEditProfiles]);

  const sheetHeader = useMemo<SheetHeader>(() => {
    if (view.kind === "all") {
      return {
        title: t("modelSelector.title"),
        actions: onEditProfiles ? (
          <Pressable
            onPress={handleEditProfiles}
            hitSlop={8}
            style={iconButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("modelSelector.editProfilesLabel")}
            testID="model-profiles-edit"
          >
            <HeaderSettingsIcon disabled={false} />
          </Pressable>
        ) : undefined,
      };
    }
    if (view.kind === "personalityGroup") {
      return {
        title: view.sectionLabel,
        leading: <ThemedBoxes size={ICON_SIZE.md} uniProps={foregroundMapping} />,
        back: { onPress: handleBackToAll },
        search: {
          onChange: handleSearchQueryChange,
          resetKey: `${view.sectionKey}:${searchResetKey}`,
          // i18n: English-only pending the agent-personalities translation pass.
          placeholder: "Search personalities and roles",
          autoFocus: platformIsWeb,
          testID: "personality-search-input",
        },
      };
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
    handleEditProfiles,
    onEditProfiles,
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
            <ThemedLoadingSpinner size="md" uniProps={foregroundMutedMapping} />
          ) : (
            <TriggerLeadingIcon
              personality={selectedPersonality}
              provider={hasSelectedProvider ? selectedProvider : null}
              size="md"
            />
          )}
          <Text style={triggerTextStyle} numberOfLines={1} ellipsizeMode="tail">
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
        desktopLockWidth
        desktopFixedHeight={desktopFixedHeight}
        desktopChildrenScrollEnabled={false}
        header={sheetHeader}
        mobileChildrenScrollEnabled={view.kind !== "provider" || !isNative}
        mobileChildrenContentContainerStyle={styles.mobileBrowserContent}
      >
        {isContentReady ? (
          <SelectorContent
            view={view}
            providers={displayProviders}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            searchQuery={searchQuery}
            favoriteKeys={favoriteKeys}
            onSelect={handleSelect}
            onToggleFavorite={onToggleFavorite}
            onDrillDown={handleDrillDown}
            onDrillDownPersonalityGroup={handleDrillDownPersonalityGroup}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
            personalities={selectableIdentities}
            personalitySectionLabel="Profiles"
            personalityGroups={personalityGroups}
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
  mobileBrowserContent: {
    paddingHorizontal: 0,
  },
  // Geometry mirrors the composer's mode/effort chips (mode-control `chip`,
  // agent-controls `modeBadge`) - all three sit in the same toolbar row and
  // must scale together on compact breakpoints.
  trigger: {
    height: compactUp(28),
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.full,
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
  // Toolbar-chip only: cap the label so a long model name ellipsizes instead of
  // stretching the composer's control row. Fill-mode form fields want the full
  // width, so this is applied only when !triggerFill. The icon + horizontal
  // padding put the whole chip in the ~200–250px range the design targets.
  triggerTextCapped: {
    maxWidth: 200,
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
}));

// The selector implementation is Otto-owned and lives in model-selector/; this file
// stays the import surface its consumers use.
export type {
  SelectorPersonality,
  SelectorPersonalityRoleGroup,
  SelectorPersonalityGroupSection,
} from "./model-selector/selector-content";
