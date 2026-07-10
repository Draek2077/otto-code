import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/open-external-url";
import { BookOpen, Copy, RotateCw, TriangleAlert } from "@/components/icons/material-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { OttoLogo, OttoLogoRobot, OttoLogoWordmark } from "@/components/icons/otto-logo";
import { Button } from "@/components/ui/button";
import { getDesktopDaemonLogs, type DesktopDaemonLogs } from "@/desktop/daemon/desktop-daemon";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

const GITHUB_ISSUE_URL = "https://github.com/Draek2077/otto-code/issues/new";
const DOCS_URL = "https://otto-code.me/docs";

const LOGO_SIZE = 96;
const PULSE_HALF_MS = 1400;

function openGithubIssue(): void {
  void openExternalUrl(GITHUB_ISSUE_URL);
}

function openDocs(): void {
  void openExternalUrl(DOCS_URL);
}

// Plain RN styles: reanimated and unistyles must not share the Animated.View's node
// (see docs/unistyles.md, "Reanimated Animated.View + Dynamic Styles Crashes").
const pulseStyles = RNStyleSheet.create({
  robotLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

// The robot layer breathes in and out of the wordmark: OTTO stays solid while the
// face hardware fades — the letterforms are the loading pulse.
function LogoPulse() {
  const robotOpacity = useSharedValue(1);

  useEffect(() => {
    robotOpacity.value = 1;
    robotOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(robotOpacity);
    };
  }, [robotOpacity]);

  const robotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: robotOpacity.value,
  }));

  const robotLayerStyle = useMemo(
    () => [pulseStyles.robotLayer, robotAnimatedStyle],
    [robotAnimatedStyle],
  );

  return (
    <View style={styles.logoStack}>
      <OttoLogoWordmark size={LOGO_SIZE} />
      <Animated.View style={robotLayerStyle}>
        <OttoLogoRobot size={LOGO_SIZE} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
  },
  errorScreen: {
    position: "relative",
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  errorScrollView: {
    flex: 1,
    ...(isWeb
      ? {
          overflowX: "auto",
          overflowY: "auto",
          WebkitAppRegion: "no-drag",
        }
      : null),
  },
  errorScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[8],
    paddingTop: theme.spacing[16],
  },
  errorContent: {
    alignItems: "stretch",
    maxWidth: 720,
    width: "100%",
    gap: theme.spacing[6],
  },
  errorHeader: {
    alignItems: "flex-start",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "left",
  },
  errorDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  errorMessage: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.code,
    lineHeight: 20,
    fontFamily: theme.fontFamily.mono,
  },
  logsMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  logsContainer: {
    height: 200,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  logsScroll: {
    flexGrow: 0,
  },
  logsContent: {
    padding: theme.spacing[4],
  },
  logsText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    lineHeight: 18,
    ...(isWeb
      ? {
          whiteSpace: "pre",
          overflowWrap: "normal",
        }
      : null),
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    flexWrap: "wrap",
  },
  logoStack: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
}));

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isCompact;
  const errorScrollRef = useRef<ScrollView>(null);
  const errorScrollbar = useWebScrollViewScrollbar(errorScrollRef, {
    enabled: showDesktopWebScrollbar,
  });
  const logsScrollRef = useRef<ScrollView>(null);
  const logsScrollbar = useWebScrollViewScrollbar(logsScrollRef, {
    enabled: showDesktopWebScrollbar,
  });
  const [daemonLogs, setDaemonLogs] = useState<DesktopDaemonLogs | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const isError = bootstrapState !== undefined && bootstrapState.splashError !== null;

  useEffect(() => {
    if (!isError) {
      setDaemonLogs(null);
      setLogsError(null);
      setIsLoadingLogs(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingLogs(true);
    setLogsError(null);

    void getDesktopDaemonLogs()
      .then((logs) => {
        if (isCancelled) {
          return;
        }
        setDaemonLogs(logs);
        return;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setDaemonLogs(null);
        setLogsError(t("startup.logs.loadFailed", { message }));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingLogs(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isError, t]);

  const logsText = useMemo(() => {
    if (isLoadingLogs) {
      return t("startup.logs.loading");
    }
    if (daemonLogs?.contents) {
      return daemonLogs.contents;
    }
    if (logsError) {
      return logsError;
    }
    return t("startup.logs.unavailable");
  }, [daemonLogs?.contents, isLoadingLogs, logsError, t]);

  const handleCopyLogs = useCallback(() => {
    const payload = daemonLogs?.logPath
      ? `${daemonLogs.logPath}\n\n${daemonLogs.contents}`
      : logsText;
    void Clipboard.setStringAsync(payload);
  }, [daemonLogs?.logPath, daemonLogs?.contents, logsText]);

  const copyIcon = useMemo(
    () => <Copy size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const warningIcon = useMemo(
    () => <TriangleAlert size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const bookIcon = useMemo(
    () => <BookOpen size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );
  const retryIcon = useMemo(
    () => <RotateCw size={16} color={theme.colors.palette.white} />,
    [theme.colors.palette.white],
  );

  if (!isError) {
    return (
      <View testID="startup-splash" style={styles.container}>
        <TitlebarDragRegion />
        <LogoPulse />
      </View>
    );
  }

  return (
    <View style={styles.errorScreen}>
      <TitlebarDragRegion />
      <ScrollView
        ref={errorScrollRef}
        style={styles.errorScrollView}
        contentContainerStyle={styles.errorScrollContent}
        onLayout={errorScrollbar.onLayout}
        onScroll={errorScrollbar.onScroll}
        onContentSizeChange={errorScrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
      >
        <View style={styles.errorContent}>
          <View style={styles.errorHeader}>
            <OttoLogo size={64} />
            <Text style={styles.title}>{t("startup.errorTitle")}</Text>
          </View>

          <Text style={styles.errorDescription}>{t("startup.errorDescription")}</Text>

          <Text dataSet={CODE_SURFACE_DATASET} style={styles.errorMessage}>
            {bootstrapState.splashError}
          </Text>

          {daemonLogs?.logPath ? <Text style={styles.logsMeta}>{daemonLogs.logPath}</Text> : null}

          <View style={styles.logsContainer}>
            <ScrollView
              ref={logsScrollRef}
              style={styles.logsScroll}
              contentContainerStyle={styles.logsContent}
              onLayout={logsScrollbar.onLayout}
              onScroll={logsScrollbar.onScroll}
              onContentSizeChange={logsScrollbar.onContentSizeChange}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={!showDesktopWebScrollbar}
            >
              <Text dataSet={CODE_SURFACE_DATASET} selectable style={styles.logsText}>
                {logsText}
              </Text>
            </ScrollView>
            {logsScrollbar.overlay}
          </View>

          <View style={styles.actionRow}>
            <Button variant="secondary" leftIcon={copyIcon} onPress={handleCopyLogs}>
              Copy logs
            </Button>
            <Button variant="outline" leftIcon={warningIcon} onPress={openGithubIssue}>
              Open GitHub issue
            </Button>
            <Button variant="outline" leftIcon={bookIcon} onPress={openDocs}>
              Docs
            </Button>
            <Button variant="default" leftIcon={retryIcon} onPress={bootstrapState.retry}>
              Retry
            </Button>
          </View>
        </View>
      </ScrollView>
      {errorScrollbar.overlay}
    </View>
  );
}
