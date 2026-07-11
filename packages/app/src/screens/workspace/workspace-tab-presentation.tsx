import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { BlobLoader, ThemedBlobLoader } from "@/components/blob-loader";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { getPanelRegistration } from "@/panels/panel-registry";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isEmphasizedStatusDotBucket } from "@/utils/status-dot-color";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import type { Theme } from "@/styles/theme";
import { compactUp, useIconSize } from "@/styles/theme";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  icon: React.ComponentType<{ size: number; color: string }>;
  statusBucket: SidebarStateBucket | null;
  /** Personality spinner colors for the busy loader; null ⇒ theme spinner. */
  personalitySpinner?: { glowA: string; glowB: string } | null;
  /** Provider id — fills the non-loading agent glyph with the personality gradient. */
  provider?: string;
}

const DEFAULT_STATUS_DOT_SIZE = 7;
const EMPHASIZED_STATUS_DOT_SIZE = 9;
const DEFAULT_STATUS_DOT_OFFSET = -2;
const EMPHASIZED_STATUS_DOT_OFFSET = -3;

interface WorkspaceTabPresentationResolverProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  children: (presentation: WorkspaceTabPresentation) => ReactNode;
}

type WorkspaceTabPresentationResolverInnerProps = WorkspaceTabPresentationResolverProps & {
  registration: NonNullable<ReturnType<typeof getPanelRegistration>>;
};

export function WorkspaceTabPresentationResolver({
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps): ReactElement {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);

  return (
    <WorkspaceTabPresentationResolverInner
      key={`${tab.key}:${tab.kind}`}
      registration={registration}
      tab={tab}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTabPresentationResolverInner>
  );
}

function WorkspaceTabPresentationResolverInner({
  registration,
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverInnerProps): ReactElement {
  const descriptor = registration.useDescriptor(tab.target as never, {
    serverId,
    workspaceId,
  });

  const presentation = useMemo(
    () => ({
      key: tab.key,
      kind: tab.kind,
      label: descriptor.label,
      subtitle: descriptor.subtitle,
      titleState: descriptor.titleState,
      icon: descriptor.icon,
      statusBucket: descriptor.statusBucket,
      personalitySpinner: descriptor.personalitySpinner ?? null,
      provider: descriptor.provider,
    }),
    [
      descriptor.icon,
      descriptor.label,
      descriptor.statusBucket,
      descriptor.subtitle,
      descriptor.titleState,
      descriptor.personalitySpinner,
      descriptor.provider,
      tab.key,
      tab.kind,
    ],
  );

  return <>{children(presentation)}</>;
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  /** Accent-colored icon — marks the selected tab in the desktop tabs row. */
  accent?: boolean;
  size?: number;
  statusDotBorderColor?: string;
}

const ThemedCheckIcon = withUnistyles(Check);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});

export function WorkspaceTabIcon({
  presentation,
  active = false,
  accent = false,
  size,
  statusDotBorderColor,
}: WorkspaceTabIconProps): ReactElement {
  const iconSize = useIconSize();
  const resolvedSize = size ?? iconSize.sm;
  let iconColor = styles.iconInactive.color;
  if (accent) {
    iconColor = styles.iconAccent.color;
  } else if (active) {
    iconColor = styles.iconActive.color;
  }
  const bucket = presentation.statusBucket;
  let statusDotColor: string | null = null;
  if (bucket === "needs_input") statusDotColor = styles.statusDotNeedsInput.color;
  else if (bucket === "failed") statusDotColor = styles.statusDotFailed.color;
  else if (bucket === "running") statusDotColor = styles.statusDotRunning.color;
  else if (bucket === "attention") statusDotColor = styles.statusDotAttention.color;
  const statusDotSize = isEmphasizedStatusDotBucket(presentation.statusBucket)
    ? EMPHASIZED_STATUS_DOT_SIZE
    : DEFAULT_STATUS_DOT_SIZE;
  const statusDotOffset =
    statusDotSize === EMPHASIZED_STATUS_DOT_SIZE
      ? EMPHASIZED_STATUS_DOT_OFFSET
      : DEFAULT_STATUS_DOT_OFFSET;
  const shouldShowLoader = shouldRenderSyncedStatusLoader({
    bucket: presentation.statusBucket,
  });
  const Icon = presentation.icon;
  const agentIconWrapperStyle = useMemo(
    () => [styles.agentIconWrapper, { width: resolvedSize, height: resolvedSize }],
    [resolvedSize],
  );
  const statusDotStyle = useMemo(
    () => [
      styles.statusDot,
      {
        backgroundColor: statusDotColor ?? undefined,
        borderColor: statusDotBorderColor ?? styles.statusDotBorderDefault.borderColor,
        width: statusDotSize,
        height: statusDotSize,
        right: statusDotOffset,
        bottom: statusDotOffset,
      },
    ],
    [statusDotColor, statusDotBorderColor, statusDotSize, statusDotOffset],
  );

  if (shouldShowLoader) {
    const spinner = presentation.personalitySpinner;
    return (
      <View style={agentIconWrapperStyle}>
        {spinner ? (
          <BlobLoader size={resolvedSize - 1} glowA={spinner.glowA} glowB={spinner.glowB} />
        ) : (
          <ThemedBlobLoader size={resolvedSize - 1} />
        )}
      </View>
    );
  }

  const spinner = presentation.personalitySpinner;
  return (
    <View style={agentIconWrapperStyle}>
      {spinner && presentation.provider ? (
        <PersonalityProviderIcon
          provider={presentation.provider}
          size={resolvedSize}
          glowA={spinner.glowA}
          glowB={spinner.glowB}
        />
      ) : (
        <Icon size={resolvedSize} color={iconColor} />
      )}
      {statusDotColor ? <View style={statusDotStyle} /> : null}
    </View>
  );
}

interface WorkspaceTabOptionRowProps {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  trailingAccessory?: ReactNode;
}

export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  onPress,
  trailingAccessory,
}: WorkspaceTabOptionRowProps): ReactElement {
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionMainPressable,
      (Boolean(hovered) || pressed || active) && styles.optionRowActive,
    ],
    [active],
  );
  const optionRowStyle = useMemo(
    () => [styles.optionRow, active && styles.optionRowActive],
    [active],
  );
  return (
    <View style={optionRowStyle}>
      <Pressable onPress={onPress} style={pressableStyle}>
        <View style={styles.optionLeadingSlot}>
          <WorkspaceTabIcon presentation={presentation} active={selected || active} />
        </View>
        <View style={styles.optionContent}>
          <Text numberOfLines={1} style={styles.optionLabel}>
            {presentation.titleState === "loading"
              ? t("workspace.tabs.loading")
              : presentation.label}
          </Text>
        </View>
      </Pressable>
      {selected ? (
        <View style={styles.optionTrailingSlot}>
          <ThemedCheckIcon uniProps={mutedColorMapping} />
        </View>
      ) : null}
      {trailingAccessory ? (
        <View style={styles.optionTrailingAccessorySlot}>{trailingAccessory}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  agentIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    position: "absolute",
    right: DEFAULT_STATUS_DOT_OFFSET,
    bottom: DEFAULT_STATUS_DOT_OFFSET,
    width: DEFAULT_STATUS_DOT_SIZE,
    height: DEFAULT_STATUS_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  statusDotBorderDefault: {
    borderColor: theme.colors.surface0,
  },
  statusDotNeedsInput: {
    color: theme.colors.palette.amber[500],
  },
  statusDotFailed: {
    color: theme.colors.palette.red[500],
  },
  statusDotRunning: {
    color: theme.colors.palette.blue[500],
  },
  statusDotAttention: {
    color: theme.colors.palette.green[500],
  },
  iconActive: {
    color: theme.colors.foreground,
  },
  iconAccent: {
    color: theme.colors.accentBright,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: 0,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionMainPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    // +4px on compact so the doubled leading icon doesn't crowd the label.
    gap: {
      xs: theme.spacing[2] + 4,
      md: theme.spacing[2],
    },
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  optionRowActive: {
    backgroundColor: theme.colors.surface1,
  },
  optionLeadingSlot: {
    width: compactUp(16),
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
    flexShrink: 1,
  },
  optionLabel: {
    // Explicit compact bump (not left to the ambient theme-patch scale) — this
    // row renders inside a bottom sheet, which can hold onto stale sizing (see
    // docs/unistyles.md's "Hidden Sheet Content" gotcha).
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    color: theme.colors.foreground,
  },
  optionTrailingSlot: {
    width: compactUp(16),
    alignItems: "center",
    justifyContent: "center",
  },
  optionTrailingAccessorySlot: {
    alignItems: "center",
    justifyContent: "center",
  },
}));
