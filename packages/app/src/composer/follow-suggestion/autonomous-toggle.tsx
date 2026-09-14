// The composer's per-chat Autonomous mode toggle: the only per-chat control for
// "Follow prompt suggestions". It sits at the message box's top-right and is the
// same 28px round icon button as the auto-speech toggle, so its state is legible
// at rest: muted when off, accent when on.
//
// The composer only renders it for chats whose provider emits prompt
// suggestions (`supportsPromptSuggestions`), so it never appears as a switch
// that cannot act.
import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Autoplay } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPOSER_ICON_SIZE } from "@/composer/composer-icon-size";
import {
  setChatFollowPromptSuggestions,
  type ChatFollowPromptSuggestionsState,
} from "@/composer/follow-suggestion/setting";
import { compactUp, type Theme } from "@/styles/theme";

const ThemedAutoplay = withUnistyles(Autoplay);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentMapping = (theme: Theme) => ({ color: theme.colors.accent });

interface AutonomousModeToggleProps {
  serverId: string;
  agentId: string;
  state: ChatFollowPromptSuggestionsState;
}

export function AutonomousModeToggle({ serverId, agentId, state }: AutonomousModeToggleProps) {
  const { t } = useTranslation();
  const enabled = state === "on";

  const handlePress = useCallback(() => {
    void setChatFollowPromptSuggestions({ serverId, agentId, enabled: !enabled }).catch(
      () => undefined,
    );
  }, [agentId, enabled, serverId]);

  const renderIcon = useCallback(
    ({ hovered }: { hovered?: boolean }) => {
      let uniProps = iconForegroundMutedMapping;
      if (enabled) {
        uniProps = iconAccentMapping;
      } else if (hovered) {
        uniProps = iconForegroundMapping;
      }
      return <ThemedAutoplay size={COMPOSER_ICON_SIZE} uniProps={uniProps} />;
    },
    [enabled],
  );

  const accessibilityState = useMemo(() => ({ checked: enabled }), [enabled]);

  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.button,
      Boolean(hovered) && styles.buttonHovered,
    ],
    [],
  );

  const label = enabled
    ? t("composer.followSuggestion.autonomousOn")
    : t("composer.followSuggestion.autonomousOff");

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handlePress}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        style={buttonStyle}
        testID="composer-autonomous-toggle"
      >
        {renderIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="end" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  // Matches the auto-speech, mic and send buttons exactly.
  button: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
