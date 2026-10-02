import { useCallback, useMemo } from "react";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Cloud } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ThemedCloud = withUnistyles(Cloud);
const mutedIcon = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const activeIcon = (theme: { colors: { accent: string } }) => ({ color: theme.colors.accent });

export function BrowserHostToggle({
  hosted,
  disabled,
  onPress,
}: {
  hosted: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const label = t("workspace.browser.controls.hostMode");
  const hint = t(
    hosted ? "workspace.browser.controls.switchToApp" : "workspace.browser.controls.switchToHost",
  );
  const accessibilityState = useMemo(() => ({ checked: hosted, disabled }), [hosted, disabled]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.button,
      hosted && styles.active,
      (hovered || pressed) && styles.hovered,
      disabled && styles.disabled,
    ],
    [hosted, disabled],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild disabled={disabled}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityState={accessibilityState}
          disabled={disabled}
          onPress={onPress}
          style={buttonStyle}
        >
          <ThemedCloud size={15} uniProps={hosted ? activeIcon : mutedIcon} />
          <Text style={[styles.text, hosted && styles.textActive]}>
            {t("workspace.browser.controls.host")}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltip}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    height: 28,
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
  },
  active: { backgroundColor: `${String(theme.colors.accent)}20` },
  hovered: { backgroundColor: theme.colors.surfaceHover },
  disabled: { opacity: 0.45 },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  textActive: { color: theme.colors.accent },
  tooltip: { fontSize: theme.fontSize.xs, color: theme.colors.popoverForeground },
}));
