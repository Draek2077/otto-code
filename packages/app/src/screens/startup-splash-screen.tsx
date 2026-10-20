import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/open-external-url";
import { BookOpen, Copy, RotateCw, TriangleAlert } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { Button } from "@/components/ui/button";
import { getDesktopDaemonLogs, type DesktopDaemonLogs } from "@/desktop/daemon/desktop-daemon";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isNative, isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { OTTO_ISSUES_NEW_URL, OTTO_WEBSITE_URL } from "@getpaseo/protocol/otto/identity";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

const GITHUB_ISSUE_URL = OTTO_ISSUES_NEW_URL; // OTTO(identity)
const DOCS_URL = `${OTTO_WEBSITE_URL}/docs`; // OTTO(identity)

const LOGO_SIZE = 96;
const SHIMMER_PEAK_WIDTH = 120;
const SHIMMER_DURATION_MS = 1800;

function openGithubIssue(): void {
  void openExternalUrl(GITHUB_ISSUE_URL);
}

function openDocs(): void {
  void openExternalUrl(DOCS_URL);
}

const WEB_SPLASH_SHIMMER_KEYFRAME_ID = "paseo-splash-shimmer-keyframes";
const WEB_SPLASH_SHIMMER_ANIMATION_NAME = "paseo-splash-shimmer";

const WEB_SPLASH_SHIMMER_KEYFRAME_CSS = `
  @keyframes ${WEB_SPLASH_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: -${LOGO_SIZE + SHIMMER_PEAK_WIDTH}px 0;
    }
    100% {
      background-position: ${LOGO_SIZE + SHIMMER_PEAK_WIDTH}px 0;
    }
  }
`;

let webSplashShimmerRegistered = false;

function ensureWebSplashShimmerKeyframes() {
  if (isNative) {
    return;
  }
  if (webSplashShimmerRegistered) {
    return;
  }
  const existing = document.getElementById(WEB_SPLASH_SHIMMER_KEYFRAME_ID);
  if (existing) {
    webSplashShimmerRegistered = true;
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_SPLASH_SHIMMER_KEYFRAME_ID;
  styleElement.textContent = WEB_SPLASH_SHIMMER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webSplashShimmerRegistered = true;
}

function LogoShimmer() {
  const { theme } = useUnistyles();

  if (isWeb) {
    return <WebLogoShimmer color={theme.colors.foreground} />;
  }

  return <NativeLogoShimmer color={theme.colors.foreground} />;
}

function WebLogoShimmer({ color }: { color: string }) {
  useEffect(() => {
    ensureWebSplashShimmerKeyframes();
  }, []);

  const shimmerStyle = useMemo(
    () => ({
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      // OTTO(identity): mask is Otto's face mark (branding/otto-icon.svg).
      WebkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${LOGO_SIZE}' height='${LOGO_SIZE}' viewBox='0 0 512 512' fill='none'><g stroke='black' stroke-width='28'><circle cx='114.72778' cy='280' r='70'/><circle cx='397.27271' cy='280' r='70'/><line x1='155.08434' y1='162' x2='251.08434' y2='162'/><line x1='216' y1='162' x2='216' y2='364'/><line x1='260.91559' y1='162' x2='356.91559' y2='162'/><line x1='296' y1='162' x2='296' y2='364'/></g><circle cx='114.72778' cy='280' r='22' fill='black'/><circle cx='397.27271' cy='280' r='22' fill='black'/></svg>`)}")`,
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      background: `linear-gradient(90deg, ${color} 0%, ${color}88 40%, ${color}FF 50%, ${color}88 60%, ${color} 100%)`,
      backgroundSize: `${LOGO_SIZE + SHIMMER_PEAK_WIDTH * 2}px ${LOGO_SIZE}px`,
      animationName: WEB_SPLASH_SHIMMER_ANIMATION_NAME,
      animationDuration: `${SHIMMER_DURATION_MS}ms`,
      animationTimingFunction: "linear",
      animationIterationCount: "infinite",
    }),
    [color],
  );

  return <View style={shimmerStyle as never} />;
}

function NativeLogoShimmer({ color }: { color: string }) {
  const shimmerTranslateX = useSharedValue(-SHIMMER_PEAK_WIDTH);

  useEffect(() => {
    shimmerTranslateX.value = -SHIMMER_PEAK_WIDTH;
    shimmerTranslateX.value = withRepeat(
      withTiming(LOGO_SIZE + SHIMMER_PEAK_WIDTH, {
        duration: SHIMMER_DURATION_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(shimmerTranslateX);
    };
  }, [shimmerTranslateX]);

  const peakStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerTranslateX.value }],
  }));

  const trackStyle = useMemo(
    () => [styles.nativeShimmerTrack, { width: LOGO_SIZE, height: LOGO_SIZE }],
    [],
  );

  const peakCombinedStyle = useMemo(
    () => [styles.nativeShimmerPeak, peakStyle, { width: SHIMMER_PEAK_WIDTH, height: LOGO_SIZE }],
    [peakStyle],
  );

  const maskElement = useMemo(
    () => (
      <View style={styles.shimmerMask}>
        <PaseoLogo size={LOGO_SIZE} color="#000000" />
      </View>
    ),
    [],
  );

  return (
    <MaskedView style={trackStyle} maskElement={maskElement}>
      <View style={trackStyle}>
        <View style={styles.nativeShimmerBase}>
          <PaseoLogo size={LOGO_SIZE} color={color} />
        </View>
        <Animated.View style={peakCombinedStyle}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <SvgLinearGradient id="splashShimmer" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.4" />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#splashShimmer)" />
          </Svg>
        </Animated.View>
      </View>
    </MaskedView>
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
    fontSize: theme.fontSize.base,
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
    fontSize: theme.fontSize.base,
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
  shimmerMask: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  nativeShimmerTrack: {
    overflow: "hidden",
  },
  nativeShimmerBase: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  nativeShimmerPeak: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
}));

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
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
        <LogoShimmer />
      </View>
    );
  }

  return (
    <View style={styles.errorScreen}>
      <TitlebarDragRegion />
      <ScrollView
        style={styles.errorScrollView}
        contentContainerStyle={styles.errorScrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.errorContent}>
          <View style={styles.errorHeader}>
            <PaseoLogo size={64} />
            <Text style={styles.title}>{t("startup.errorTitle")}</Text>
          </View>

          <Text style={styles.errorDescription}>{t("startup.errorDescription")}</Text>

          <Text dataSet={CODE_SURFACE_DATASET} style={styles.errorMessage}>
            {bootstrapState.splashError}
          </Text>

          {daemonLogs?.logPath ? <Text style={styles.logsMeta}>{daemonLogs.logPath}</Text> : null}

          <View style={styles.logsContainer}>
            <ScrollView
              style={styles.logsScroll}
              contentContainerStyle={styles.logsContent}
              showsVerticalScrollIndicator
            >
              <Text dataSet={CODE_SURFACE_DATASET} selectable style={styles.logsText}>
                {logsText}
              </Text>
            </ScrollView>
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
    </View>
  );
}
