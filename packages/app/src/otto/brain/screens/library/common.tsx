import { useStyles } from "./styles";

import { EditingTextInput as TextInput } from "@/components/ui/text-input";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { withBrainTheme, useBrainScreenTheme } from "../theme";
import type { BrainJob } from "../contracts/models";
import { CircleCheck, Download, HardDrive, Medal, Settings2 } from "../ui/icons";
import { BrainModelFamilyIcon } from "../ui/model-family-icon";

import type { BrainScreenTheme as Theme } from "../theme";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const ThemedTextInput = withBrainTheme(TextInput);
const ThemedDownload = withBrainTheme(Download);
const ThemedHardDrive = withBrainTheme(HardDrive);
const ThemedCircleCheck = withBrainTheme(CircleCheck);
const ThemedBundleOptions = withBrainTheme(Settings2);
export const ThemedFavorite = withBrainTheme(Medal);
export const ThemedBrainModelFamilyIcon = withBrainTheme(BrainModelFamilyIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const foregroundIcon = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const successIcon = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
  size: theme.iconSize.sm,
});
export const favoriteIcon = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
  size: theme.iconSize.sm,
});

export const downloadIcon = <ThemedDownload uniProps={foregroundIcon} />;
export const runtimeIcon = <ThemedHardDrive uniProps={foregroundIcon} />;
export const installedIcon = <ThemedCircleCheck uniProps={successIcon} />;
export const bundleOptionsIcon = <ThemedBundleOptions uniProps={foregroundIcon} />;
export const runtimeManagerHeader = {
  title: "Manage runtime",
};

type BrainErrorReporter = (context: string, error: unknown) => void;
interface BrainOperationError {
  title: string;
  message: string;
}
const OperationErrorContext = createContext<BrainErrorReporter | null>(null);

/** Brain owns this acknowledgment dialog because the current app has no alertDialog helper. */
export function BrainOperationErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<BrainOperationError | null>(null);
  const reportError = useCallback<BrainErrorReporter>((context, cause) => {
    setError({ title: context, message: cause instanceof Error ? cause.message : String(cause) });
  }, []);
  const close = useCallback(() => setError(null), []);
  const header = useMemo(() => ({ title: error?.title ?? "Brain" }), [error?.title]);
  const footer = useMemo(() => <Button onPress={close}>OK</Button>, [close]);
  return (
    <OperationErrorContext value={reportError}>
      {children}
      <AdaptiveModalSheet
        visible={error !== null}
        onClose={close}
        header={header}
        footer={footer}
        desktopMaxWidth={480}
      >
        {error ? <Alert variant="error" description={error.message} /> : null}
      </AdaptiveModalSheet>
    </OperationErrorContext>
  );
}

export function useReportBrainError(): BrainErrorReporter {
  const reportError = useContext(OperationErrorContext);
  if (!reportError)
    throw new Error("BrainOperationErrorProvider is required for Brain operations.");
  return reportError;
}

/** Local submission latch only; accepted jobs still belong to the injected host store. */
export function useDownloadSubmission() {
  const reportError = useReportBrainError();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const submit = useCallback(
    async (operation: () => Promise<void>) => {
      // Ref closes the gap before React renders the disabled button.
      if (submitting.current) return;
      submitting.current = true;
      setPending(true);
      try {
        await operation();
      } catch (error) {
        reportError("Unable to start the download", error);
      } finally {
        submitting.current = false;
        setPending(false);
      }
    },
    [reportError],
  );
  return { pending, submit };
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
}

// Progress + jobs

function ProgressBar({ percent }: { percent: number | null }) {
  const styles = useStyles();
  const fillStyle = useMemo(() => {
    if (percent === null) {
      return [styles.progressFill, styles.progressIndeterminate];
    }
    return [styles.progressFill, { width: `${Math.max(2, Math.min(100, percent))}%` as const }];
  }, [styles, percent]);
  return (
    <View style={styles.progressTrack}>
      <View style={fillStyle} />
    </View>
  );
}

/**
 * Just the bar, right under whatever button started the job it belongs to -
 * no label, no percent readout, no message. `jobs.find(...)` at each call
 * site is the whole "is this row downloading" check; nothing else renders
 * the job list, so there is no separate download-manager panel to keep in
 * sync with these bars.
 */
export function InlineJobProgress({
  job,
  style,
}: {
  job: BrainJob | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  if (!job || job.status !== "running") {
    return null;
  }
  return (
    <View style={[styles.inlineProgress, style]}>
      <ProgressBar percent={job.percent} />
    </View>
  );
}

const DOWNLOAD_RING_SIZE = 20;
const DOWNLOAD_RING_CENTER = DOWNLOAD_RING_SIZE / 2;
const DOWNLOAD_RING_RADIUS = 8;
const DOWNLOAD_RING_STROKE = 3;
const DOWNLOAD_RING_CIRCUMFERENCE = 2 * Math.PI * DOWNLOAD_RING_RADIUS;
const DOWNLOAD_RING_ROTATE = `rotate(-90 ${DOWNLOAD_RING_CENTER} ${DOWNLOAD_RING_CENTER})`;

function DownloadProgressRing({
  job,
  trackColor,
  progressColor,
}: {
  job: BrainJob | undefined;
  trackColor: string;
  progressColor: string;
}) {
  // A job may not have received a byte count yet. Keep a small visible arc in
  // that short interval instead of implying that the download is complete.
  const percent = Math.max(4, Math.min(100, job?.percent ?? 12));
  const dashOffset = DOWNLOAD_RING_CIRCUMFERENCE * (1 - percent / 100);
  const progressValue = useMemo(() => ({ now: Math.round(percent), min: 0, max: 100 }), [percent]);
  if (!job || job.status !== "running") return null;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Downloading model"
      accessibilityValue={progressValue}
    >
      <Svg
        width={DOWNLOAD_RING_SIZE}
        height={DOWNLOAD_RING_SIZE}
        viewBox={`0 0 ${DOWNLOAD_RING_SIZE} ${DOWNLOAD_RING_SIZE}`}
        aria-hidden
      >
        <G transform={DOWNLOAD_RING_ROTATE}>
          <Circle
            cx={DOWNLOAD_RING_CENTER}
            cy={DOWNLOAD_RING_CENTER}
            r={DOWNLOAD_RING_RADIUS}
            fill="none"
            stroke={trackColor}
            strokeWidth={DOWNLOAD_RING_STROKE}
          />
          <Circle
            cx={DOWNLOAD_RING_CENTER}
            cy={DOWNLOAD_RING_CENTER}
            r={DOWNLOAD_RING_RADIUS}
            fill="none"
            stroke={progressColor}
            strokeWidth={DOWNLOAD_RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={DOWNLOAD_RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </G>
      </Svg>
    </View>
  );
}

export function ThemedDownloadProgressRing({ job }: { job: BrainJob | undefined }) {
  const theme = useBrainScreenTheme();
  return (
    <DownloadProgressRing
      job={job}
      trackColor={theme.colors.surface3}
      progressColor={theme.colors.accent}
    />
  );
}
