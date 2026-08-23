import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useIsCompactFormFactor } from "@/constants/layout";
import { compactUp } from "@/styles/theme";
import {
  getAgentControlHintKey,
  getModeTierColor,
  hexColorWithAlpha,
  type ModeTierColors,
} from "@/composer/agent-controls/utils";
import { formatAgentModeLabel } from "@/agent-controls/labels";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { resolveModeSelection, resolveNextAgentModeId } from "@/composer/agent-controls/mode";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import type { AgentMode, AgentProvider } from "@otto-code/protocol/agent-types";
import {
  getModeVisuals,
  type AgentProviderDefinition,
} from "@otto-code/protocol/provider-manifest";
import { getAgentModeIcon, getAgentModeOptionIcon } from "@/agent-controls/icons";
import type { IconSizeProp } from "@/components/icons/icon-size";

// The Mode chip always lives inline in the toolbar - it shrinks to an icon-only
// badge when compact rather than dropping below the input box.

interface ModeIconProps {
  size?: IconSizeProp;
  color?: string;
}
interface ModeComboboxOptionProps {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  iconColor: string;
  tierColors: ModeTierColors;
}

function ModeComboboxOption({
  option,
  selected,
  active,
  onPress,
  provider,
  providerDefinitions,
  iconColor,
  tierColors,
}: ModeComboboxOptionProps) {
  const visuals = getModeVisuals(provider, option.id, providerDefinitions);
  const IconComponent = getAgentModeOptionIcon(provider, option.id, providerDefinitions);
  const tierColor = getModeTierColor(visuals?.colorTier, tierColors);
  const resolvedIconColor = tierColor ?? iconColor;
  const leadingSlot = useMemo(
    () => (IconComponent ? <IconComponent size="md" color={resolvedIconColor} /> : null),
    [IconComponent, resolvedIconColor],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
      labelColor={tierColor}
    />
  );
}

export interface AgentModeControlValue {
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId: string | null | undefined;
  onSelectMode: (modeId: string) => void;
  disabled?: boolean;
  /** Live agents can expose a non-selectable current mode that must remain visible. */
  lockNonSelectable?: boolean;
}

interface AgentModeControlViewProps extends AgentModeControlValue {
  /** Render as an icon-only badge (compact toolbar) instead of an icon + label chip. */
  iconOnly?: boolean;
  onClose?: () => void;
}

interface ModeChipVisuals {
  Icon: ComponentType<ModeIconProps> | undefined;
  iconColor: string;
  tierColor: string | undefined;
  // Tier-tinted chip backgrounds: at-rest and hover/press/open. Non-neutral modes
  // tint the whole chip so the active mode reads at a glance.
  tierTint: string | undefined;
  tierTintActive: string | undefined;
  label: string;
}

// Pure derivation of the mode chip's icon, tier color, tints, and label from the
// active mode. Returns neutral defaults when there is no active mode.
function resolveModeChipVisuals({
  selectedMode,
  provider,
  providerDefinitions,
  tierColors,
  mutedColor,
}: {
  selectedMode: AgentMode | null;
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  tierColors: ModeTierColors;
  mutedColor: string;
}): ModeChipVisuals {
  const visuals = selectedMode
    ? getModeVisuals(provider, selectedMode.id, providerDefinitions)
    : undefined;
  const tierColor = getModeTierColor(visuals?.colorTier, tierColors);
  return {
    Icon: getAgentModeIcon(provider, selectedMode?.id ?? "", providerDefinitions),
    iconColor: tierColor ?? mutedColor,
    tierColor,
    tierTint: tierColor ? hexColorWithAlpha(tierColor, 0.05) : undefined,
    tierTintActive: tierColor ? hexColorWithAlpha(tierColor, 0.1) : undefined,
    label: selectedMode ? formatAgentModeLabel(selectedMode) : "",
  };
}

interface LockedAgentModeBadgeProps {
  Icon: ComponentType<ModeIconProps> | undefined;
  iconColor: string;
  tierColor: string | undefined;
  tierTint: string | undefined;
  label: string;
  iconOnly: boolean;
}

// Static, non-interactive rendering of a mode the user can't change (Claude
// "dontAsk"): same chip footprint and tier tint, but no dropdown or hover/press.
// (i18n: English-only pending a translation pass for this copy.)
function LockedAgentModeBadge({
  Icon,
  iconColor,
  tierColor,
  tierTint,
  label,
  iconOnly,
}: LockedAgentModeBadgeProps): ReactElement {
  const { theme } = useUnistyles();
  const badgeStyle = useMemo(
    () => [
      iconOnly ? styles.iconChip : styles.chip,
      tierTint ? { backgroundColor: tierTint } : null,
    ],
    [iconOnly, tierTint],
  );
  const labelStyle = useMemo(
    () => [styles.chipLabel, tierColor ? { color: tierColor } : null],
    [tierColor],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          collapsable={false}
          style={badgeStyle}
          accessibilityRole="text"
          accessibilityLabel={`${label} (locked)`}
          testID="mode-control-locked"
        >
          {Icon ? <Icon size={theme.iconSize.md} color={iconColor} /> : null}
          {iconOnly ? null : (
            <Text style={labelStyle} numberOfLines={1} ellipsizeMode="tail">
              {label}
            </Text>
          )}
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>
          {`Runs in ${label} - this mode is locked and can't be changed.`}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function AgentModeControlView({
  provider,
  providerDefinitions,
  modeOptions,
  selectedModeId,
  onSelectMode,
  disabled = false,
  iconOnly = false,
  lockNonSelectable = false,
  onClose,
}: AgentModeControlViewProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { isActiveComposer } = useComposerKeyboardScope();
  const cycleShortcutKeys = useShortcutKeys("cycle-agent-mode");
  const anchorRef = useRef<View>(null);
  const keyboardHandlerIdRef = useRef(`mode-control:${Math.random().toString(36).slice(2)}`);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);

  const { selectableModes, selectedMode, isLocked } = useMemo(
    () => resolveModeSelection({ provider, modeOptions, selectedModeId, lockNonSelectable }),
    [provider, modeOptions, selectedModeId, lockNonSelectable],
  );

  const tierColors = useMemo<ModeTierColors>(
    () => ({
      safe: theme.colors.statusSuccess,
      moderate: theme.colors.statusWarning,
      dangerous: theme.colors.statusDanger,
      planning: theme.colors.statusInfo,
    }),
    [
      theme.colors.statusSuccess,
      theme.colors.statusWarning,
      theme.colors.statusDanger,
      theme.colors.statusInfo,
    ],
  );

  const {
    Icon,
    iconColor,
    tierColor,
    tierTint,
    tierTintActive,
    label: selectedModeLabel,
  } = resolveModeChipVisuals({
    selectedMode,
    provider,
    providerDefinitions,
    tierColors,
    mutedColor: theme.colors.foregroundMuted,
  });

  // Modes are a small finite set (like effort levels) - no search needed. Only
  // user-selectable modes appear as options.
  const options = useMemo<ComboboxOption[]>(
    () => selectableModes.map((m) => ({ id: m.id, label: formatAgentModeLabel(m) })),
    [selectableModes],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      const wasOpen = openRef.current;
      openRef.current = next;
      setOpen(next);
      if (!next && wasOpen) onClose?.();
    },
    [onClose],
  );

  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelectMode(id);
      handleOpenChange(false);
    },
    [onSelectMode, handleOpenChange],
  );

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.mode-cycle") return false;
      if (disabled || isLocked || !isActiveComposer) return false;
      // Cycle only through selectable modes (never lands on a hidden one).
      const nextModeId = resolveNextAgentModeId({
        modeOptions: selectableModes,
        selectedMode: selectedModeId,
      });
      if (!nextModeId) return false;
      onSelectMode(nextModeId);
      return true;
    },
    [disabled, isLocked, isActiveComposer, selectableModes, onSelectMode, selectedModeId],
  );

  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: ["message-input.mode-cycle"],
    enabled: isActiveComposer && !disabled && !isLocked && selectableModes.length > 1,
    priority: 200,
    handle: handleKeyboardAction,
  });

  const renderOption = useCallback(
    (args: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => (
      <ModeComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        provider={provider}
        providerDefinitions={providerDefinitions}
        iconColor={theme.colors.foreground}
        tierColors={tierColors}
      />
    ),
    [provider, providerDefinitions, theme.colors.foreground, tierColors],
  );

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      iconOnly ? styles.iconChip : styles.chip,
      hovered && styles.chipHovered,
      (pressed || open) && styles.chipPressed,
      tierTint ? { backgroundColor: hovered || pressed || open ? tierTintActive : tierTint } : null,
      disabled && styles.chipDisabled,
    ],
    [open, disabled, iconOnly, tierTint, tierTintActive],
  );

  // Low-churn inline color (one value per tier per theme); flows through React
  // like the icon colors above rather than the Unistyles native path.
  const labelStyle = useMemo(
    () => [styles.chipLabel, tierColor ? { color: tierColor } : null],
    [tierColor],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: t("agentControls.mode.title"),
    }),
    [t],
  );

  if (!selectedMode) return null;

  // Locked: the agent's active mode isn't user-selectable (Claude "dontAsk"). Show
  // it as a static badge - visible but with no dropdown - so it's clear the agent
  // is stuck in it.
  if (isLocked) {
    return (
      <LockedAgentModeBadge
        Icon={Icon}
        iconColor={iconColor}
        tierColor={tierColor}
        tierTint={tierTint}
        label={selectedModeLabel}
        iconOnly={iconOnly}
      />
    );
  }

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <ComboboxTrigger
            ref={anchorRef}
            collapsable={false}
            disabled={disabled}
            onPress={handlePress}
            style={pressableStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.mode.selectWithValue", {
              value: selectedModeLabel,
            })}
            testID="mode-control"
            chevron={iconOnly ? null : undefined}
          >
            {Icon ? <Icon size={theme.iconSize.md} color={iconColor} /> : null}
            {iconOnly ? null : (
              <Text style={labelStyle} numberOfLines={1} ellipsizeMode="tail">
                {selectedModeLabel}
              </Text>
            )}
          </ComboboxTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{t(getAgentControlHintKey("mode"))}</Text>
            {isActiveComposer && cycleShortcutKeys ? <Shortcut chord={cycleShortcutKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={options}
        value={selectedMode.id}
        onSelect={handleSelect}
        searchable={false}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        header={sheetHeader}
        renderOption={renderOption}
      />
    </>
  );
}

const EMPTY_MODES: AgentMode[] = [];

function compareAvailableModes(a: AgentMode[], b: AgentMode[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export const AgentModeControl = memo(function AgentModeControl({
  surface = "toolbar",
  onClose,
  iconOnly: iconOnlyOverride,
  ...value
}: AgentModeControlValue & {
  surface?: "toolbar" | "sheet";
  onClose?: () => void;
  iconOnly?: boolean;
}) {
  const { presentation } = useComposerControlLayout();
  return (
    <AgentModeControlView
      {...value}
      iconOnly={iconOnlyOverride ?? (surface === "toolbar" && !presentation.showModeLabel)}
      onClose={onClose}
    />
  );
});

export function useLiveAgentModeControl(
  serverId: string,
  agentId: string,
): AgentModeControlValue | null {
  const slice = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      if (!agent) return null;
      return {
        provider: agent.provider,
        cwd: agent.cwd,
        currentModeId: agent.currentModeId,
      };
    }),
  );
  const availableModes = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.availableModes ?? EMPTY_MODES,
    compareAvailableModes,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { updatePreferences } = useFormPreferences();
  const toast = useToast();
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId, { cwd: slice?.cwd });

  const providerDefinitions = useMemo<AgentProviderDefinition[]>(() => {
    if (!slice?.provider) return [];
    const definition = resolveProviderDefinition(slice.provider, snapshotEntries);
    return definition ? [definition] : [];
  }, [slice?.provider, snapshotEntries]);

  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (!client || !slice?.provider) return;
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: slice.provider,
          updates: { mode: modeId || undefined },
        }),
      ).catch((error) => {
        console.warn("[AgentModeControl] persist mode preference failed", error);
      });
      void client
        .setAgentMode(agentId, modeId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentModeControl] setAgentMode failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, client, slice?.provider, toast, updatePreferences],
  );

  return useMemo(() => {
    if (!slice || availableModes.length === 0) return null;
    return {
      provider: slice.provider,
      providerDefinitions,
      modeOptions: availableModes,
      selectedModeId: slice.currentModeId,
      onSelectMode: handleSelectMode,
      disabled: !client,
      lockNonSelectable: true,
    };
  }, [availableModes, client, handleSelectMode, providerDefinitions, slice]);
}

export interface DraftAgentModeControlProps {
  selectedProvider: AgentProvider | null;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  disabled?: boolean;
  isCompactLayout?: boolean;
}

export function DraftAgentModeControl({
  selectedProvider,
  providerDefinitions,
  modeOptions,
  selectedMode,
  onSelectMode,
  disabled,
  isCompactLayout,
}: DraftAgentModeControlProps) {
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  if (!selectedProvider || modeOptions.length === 0) return null;
  return (
    <AgentModeControlView
      provider={selectedProvider}
      providerDefinitions={providerDefinitions}
      modeOptions={modeOptions}
      selectedModeId={selectedMode}
      onSelectMode={onSelectMode}
      disabled={disabled}
      iconOnly={isCompact}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    height: compactUp(28),
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.full,
  },
  iconChip: {
    width: compactUp(28),
    height: compactUp(28),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.full,
  },
  chipHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  chipPressed: {
    backgroundColor: theme.colors.surface0,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
