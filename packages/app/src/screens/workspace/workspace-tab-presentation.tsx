import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { getPanelRegistration } from "@/panels/panel-registry";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
// WorkspaceTabIcon lives in its own module so leaf consumers (e.g. the
// subagents track) can render a tab glyph without pulling in the panel
// registry — importing it from here would close a require cycle.
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-icon";
import type { Theme } from "@/styles/theme";
import { compactUp } from "@/styles/theme";

export { WorkspaceTabIcon };
export type { WorkspaceTabPresentation };

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

const ThemedCheckIcon = withUnistyles(Check);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});

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
