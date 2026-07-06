import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Heart } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { DiscordIcon } from "@/components/icons/discord-icon";
import { openExternalUrl } from "@/utils/open-external-url";
import { useIconSize } from "@/styles/theme";

export function CommunityLinks() {
  const iconSize = useIconSize();

  const renderGitHubIcon = useCallback(
    (color: string) => <GitHubIcon color={color} size={iconSize.sm} />,
    [iconSize.sm],
  );
  const renderHeartIcon = useCallback(
    (color: string) => <Heart color={color} size={iconSize.sm} />,
    [iconSize.sm],
  );
  const renderDiscordIcon = useCallback(
    (color: string) => <DiscordIcon color={color} size={iconSize.sm} />,
    [iconSize.sm],
  );

  const handleOpenGitHub = useCallback(() => {
    void openExternalUrl("https://github.com/Draek2077/otto-code");
  }, []);

  const handleOpenSponsor = useCallback(() => {
    void openExternalUrl("https://github.com/sponsors/boudra");
  }, []);

  const handleOpenDiscord = useCallback(() => {
    void openExternalUrl("https://discord.gg/jz8T2uahpH");
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        renderLeftIcon={renderGitHubIcon}
        onPress={handleOpenGitHub}
        testID="community-links-github-star"
      >
        Star
      </Button>
      <Button
        variant="ghost"
        size="sm"
        renderLeftIcon={renderHeartIcon}
        onPress={handleOpenSponsor}
        testID="community-links-sponsor"
      >
        Sponsor
      </Button>
      <Button
        variant="ghost"
        size="sm"
        renderLeftIcon={renderDiscordIcon}
        onPress={handleOpenDiscord}
        testID="community-links-discord"
      >
        Community
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
