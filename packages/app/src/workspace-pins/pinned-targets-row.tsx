import type { ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ResolvedPin } from "@/workspace-pins/launch";

function pinButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.pinButton, (Boolean(hovered) || pressed) && styles.pinButtonHovered];
}

function PinnedTargetShortcutHint({
  launcher,
  enabled,
}: {
  launcher: ResolvedPin;
  enabled: boolean;
}) {
  switch (launcher.target.kind) {
    case "draft":
      return (
        <ShortcutDiscoveryHint
          action="workspace.tab.new"
          enabled={enabled}
          style={styles.shortcutDiscoveryHint}
        />
      );
    case "terminal":
      return (
        <ShortcutDiscoveryHint
          action="workspace.terminal.new"
          enabled={enabled}
          style={styles.shortcutDiscoveryHint}
        />
      );
    default:
      return null;
  }
}

interface PinnedTargetsRowProps {
  launchers: ResolvedPin[];
  testIdPrefix: string;
  shortcutDiscoveryVisible?: boolean;
}

export function PinnedTargetsRow({
  launchers,
  testIdPrefix,
  shortcutDiscoveryVisible = true,
}: PinnedTargetsRowProps): ReactElement {
  return (
    <View style={styles.row}>
      {launchers.map((launcher) => (
        <Tooltip key={launcher.key} delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger
            testID={`${testIdPrefix}-${launcher.key}`}
            onPress={launcher.onPress}
            accessibilityRole="button"
            accessibilityLabel={launcher.label}
            style={pinButtonStyle}
          >
            <View style={styles.shortcutDiscoveryAnchor}>
              {launcher.icon}
              <PinnedTargetShortcutHint launcher={launcher} enabled={shortcutDiscoveryVisible} />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.tooltipText}>{launcher.label}</Text>
          </TooltipContent>
        </Tooltip>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  pinButton: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  pinButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  shortcutDiscoveryAnchor: {
    position: "relative",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
