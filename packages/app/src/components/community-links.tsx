import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Heart, Forum } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { openLink } from "@/utils/open-link";
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
  const renderForumIcon = useCallback(
    (color: string) => <Forum color={color} size={iconSize.sm} />,
    [iconSize.sm],
  );
  const githubIcon = useMemo(() => ({ render: renderGitHubIcon }), [renderGitHubIcon]);
  const heartIcon = useMemo(() => ({ render: renderHeartIcon }), [renderHeartIcon]);
  const forumIcon = useMemo(() => ({ render: renderForumIcon }), [renderForumIcon]);

  const handleOpenGitHub = useCallback(() => {
    void openLink("https://github.com/Draek2077/otto-code");
  }, []);

  // Otto takes no sponsorships of its own — this points at Paseo, the upstream
  // project Otto is forked from. The label has to say so: a bare "Sponsor" next
  // to Otto's own Star/Feedback buttons reads as sponsoring Otto.
  const handleOpenSponsor = useCallback(() => {
    void openLink("https://github.com/sponsors/boudra");
  }, []);

  const handleOpenIssues = useCallback(() => {
    void openLink("https://github.com/Draek2077/otto-code/issues");
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={githubIcon}
        onPress={handleOpenGitHub}
        testID="community-links-github-star"
      >
        Star
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={heartIcon}
        onPress={handleOpenSponsor}
        testID="community-links-sponsor"
      >
        Sponsor Paseo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={forumIcon}
        onPress={handleOpenIssues}
        testID="community-links-issues"
      >
        Feedback
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
    // Row-container parents don't shrink children by default, which keeps the
    // buttons on one overflowing line instead of letting flexWrap kick in.
    flexShrink: 1,
    maxWidth: "100%",
  },
}));
