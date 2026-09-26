import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Category,
  Copy,
  Download,
  FitScreen,
  Map as MapIcon,
  Pause,
  Play,
  Route,
  Search,
  ZoomIn,
  ZoomOut,
} from "@/components/icons/material-icons";
import { FileEditorWarningBanner } from "@/components/file-editor-warning-banner";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  ToolbarIconButton,
  useToolbarIconButtonStyle,
  type ToolbarIconComponent,
} from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InteractiveViewFrame } from "@/components/architectural-views/interactive-view-frame";
import { isNative, isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-api-context";
import type { InteractiveViewController } from "@/architectural-views/use-interactive-view";
import type {
  InteractiveViewCommand,
  InteractiveViewExportFormat,
} from "@/architectural-views/view-bridge";
import {
  architecturalViewTypeLabel,
  type ArchitecturalViewDiagramType,
} from "@/project-knowledge/architectural-view-types";
import type { Theme } from "@/styles/theme";

export type InteractiveViewSourceStatus = "current" | "stale" | "unknown";

const ThemedSearch = withUnistyles(Search);
const ThemedCategory = withUnistyles(Category);
const ThemedRoute = withUnistyles(Route);
const ThemedMap = withUnistyles(MapIcon);
const ThemedZoomIn = withUnistyles(ZoomIn);
const ThemedZoomOut = withUnistyles(ZoomOut);
const ThemedFitScreen = withUnistyles(FitScreen);
const ThemedPlay = withUnistyles(Play);
const ThemedPause = withUnistyles(Pause);
const ThemedDownload = withUnistyles(Download);
const ThemedCopy = withUnistyles(Copy);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const menuIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Feeds the live Otto theme to the View controller. A `withUnistyles` leaf is
 * the sanctioned way to move theme values through React (docs/unistyles.md).
 */
function ThemeSource({ theme, onTheme }: { theme?: Theme; onTheme: (theme: Theme) => void }): null {
  useEffect(() => {
    if (theme) onTheme(theme);
  }, [onTheme, theme]);
  return null;
}
const ThemedThemeSource = withUnistyles(ThemeSource);
const themeProps = (theme: Theme) => ({ theme });

function sourceStatusWarning(status: InteractiveViewSourceStatus | undefined): string | null {
  if (status === "stale") {
    return "The Knowledge this View was published from has changed. Update the View to bring it in line.";
  }
  return null;
}

/**
 * The document canvas of an Interactive View: pinned notices on top, the
 * themed, bridged View below. Toolbar and status bar are placed by the host
 * surface, the same way the File Editor composes its panes.
 */
export function InteractiveViewCanvas({
  controller,
  html,
  loading,
  error,
  sourceStatus,
  browserAutomation,
}: {
  controller: InteractiveViewController;
  html: string | null;
  loading: boolean;
  error: string | null;
  sourceStatus?: InteractiveViewSourceStatus;
  browserAutomation?: { browserId: string; workspaceId: string };
}): ReactElement {
  const staleWarning = sourceStatusWarning(sourceStatus);
  const [staleDismissed, setStaleDismissed] = useState(false);
  useEffect(() => setStaleDismissed(false), [html]);
  const dismissStale = useCallback(() => setStaleDismissed(true), []);

  return (
    <View style={styles.canvas}>
      <ThemedThemeSource uniProps={themeProps} onTheme={controller.onTheme} />
      {staleWarning && !staleDismissed ? (
        <FileEditorWarningBanner
          message={staleWarning}
          dismissLabel="Dismiss source change notice"
          onDismiss={dismissStale}
          testID="interactive-view-stale-banner"
        />
      ) : null}
      {controller.notice ? (
        <FileEditorWarningBanner
          message={controller.notice}
          dismissLabel="Dismiss Interactive View notice"
          onDismiss={controller.dismissNotice}
          testID="interactive-view-notice"
        />
      ) : null}
      {html && controller.document ? (
        <InteractiveViewFrame
          html={controller.document}
          background={controller.background}
          handleRef={controller.handleRef}
          onEvent={controller.onGuestEvent}
          browserAutomation={browserAutomation}
        />
      ) : (
        <View style={styles.centered}>
          {loading || (html && !controller.document) ? <LoadingSpinner size="small" /> : null}
          <Text style={styles.message}>
            {error ?? (html ? "Preparing Interactive View…" : "Loading Interactive View…")}
          </Text>
        </View>
      )}
    </View>
  );
}

const EXPORT_FORMATS: readonly { format: InteractiveViewExportFormat; label: string }[] = [
  { format: "png", label: "PNG image" },
  { format: "svg", label: "SVG vector" },
  { format: "jpeg", label: "JPEG image" },
  { format: "webp", label: "WebP image" },
];

const DOWNLOAD_LEADING = <ThemedDownload size="sm" uniProps={menuIconColor} />;
const MOTION_LEADING = <ThemedPlay size="sm" uniProps={menuIconColor} />;
const COPY_LEADING = <ThemedCopy size="sm" uniProps={menuIconColor} />;

function ExportFormatItem({
  format,
  label,
  leading,
  onExport,
}: {
  format: InteractiveViewExportFormat;
  label: string;
  leading: ReactElement;
  onExport: (format: InteractiveViewExportFormat) => void;
}): ReactElement {
  const select = useCallback(() => onExport(format), [format, onExport]);
  return (
    <DropdownMenuItem
      leading={leading}
      onSelect={select}
      testID={`interactive-view-export-${format}`}
    >
      {label}
    </DropdownMenuItem>
  );
}

function InteractiveViewExportMenu({
  controller,
}: {
  controller: InteractiveViewController;
}): ReactElement {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const busy = controller.pending !== null;
  const disabled = !controller.state || busy;
  const triggerStyle = useToolbarIconButtonStyle({ disabled, selected: open });
  const label = "Export Interactive View";

  const runExport = useCallback(
    (format: InteractiveViewExportFormat) => {
      void controller.exportAs(format).then((file) => {
        if (file) toast.show(`Exported ${file.fileName}`, { variant: "success" });
        return undefined;
      });
    },
    [controller, toast],
  );
  const copy = useCallback(() => {
    void controller.copyImage().then((copied) => {
      if (copied) toast.copied("Image");
      return undefined;
    });
  }, [controller, toast]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            style={triggerStyle}
            testID="interactive-view-export"
          >
            {busy ? (
              <LoadingSpinner size="md" />
            ) : (
              <ThemedDownload size="md" uniProps={mutedIconColor} />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.tooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="bottom" offset={4} minWidth={200}>
        {EXPORT_FORMATS.map(({ format, label: itemLabel }) => (
          <ExportFormatItem
            key={format}
            format={format}
            label={itemLabel}
            leading={DOWNLOAD_LEADING}
            onExport={runExport}
          />
        ))}
        {controller.state?.motion ? (
          <ExportFormatItem
            format="webm"
            label="WebM motion"
            leading={MOTION_LEADING}
            onExport={runExport}
          />
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={COPY_LEADING}
          onSelect={copy}
          testID="interactive-view-copy-image"
        >
          Copy image
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewCommandButton({
  label,
  Icon,
  command,
  run,
  selected,
  disabled,
  testID,
}: {
  label: string;
  Icon: ToolbarIconComponent;
  command: InteractiveViewCommand;
  run: InteractiveViewController["run"];
  selected?: boolean;
  disabled?: boolean;
  testID: string;
}): ReactElement {
  const press = useCallback(() => void run(command), [command, run]);
  return (
    <ToolbarIconButton
      label={label}
      Icon={Icon}
      onPress={press}
      selected={selected}
      disabled={disabled}
      testID={testID}
    />
  );
}

const FIND: InteractiveViewCommand = { type: "find" };
const LENS: InteractiveViewCommand = { type: "lens" };
const ROUTE: InteractiveViewCommand = { type: "route" };
const MAP: InteractiveViewCommand = { type: "map" };
const ZOOM_OUT: InteractiveViewCommand = { type: "zoomOut" };
const ZOOM_IN: InteractiveViewCommand = { type: "zoomIn" };
const FIT: InteractiveViewCommand = { type: "fit" };
const MOTION: InteractiveViewCommand = { type: "motion" };

/**
 * The View's actions for a host toolbar: reader tools that used to float in
 * the viewer's own dock, zoom, motion, and export.
 */
export function InteractiveViewActions({
  controller,
}: {
  controller: InteractiveViewController;
}): ReactElement {
  const { state, run } = controller;
  const disabled = !state;
  const motionLive = state?.motion === "live";
  return (
    <>
      <ViewCommandButton
        label="Find in View"
        Icon={ThemedSearch}
        command={FIND}
        run={run}
        selected={state?.finderOpen === true}
        disabled={disabled}
        testID="interactive-view-find"
      />
      <ViewCommandButton
        label="Semantic lens"
        Icon={ThemedCategory}
        command={LENS}
        run={run}
        selected={state?.lensOpen === true}
        disabled={disabled}
        testID="interactive-view-lens"
      />
      <ViewCommandButton
        label="Trace a route"
        Icon={ThemedRoute}
        command={ROUTE}
        run={run}
        selected={state?.routeOpen === true}
        disabled={disabled}
        testID="interactive-view-route"
      />
      <ViewCommandButton
        label="Overview map"
        Icon={ThemedMap}
        command={MAP}
        run={run}
        selected={state?.mapOpen === true}
        disabled={disabled}
        testID="interactive-view-map"
      />
      <ToolbarSeparator />
      <ViewCommandButton
        label="Zoom out"
        Icon={ThemedZoomOut}
        command={ZOOM_OUT}
        run={run}
        disabled={disabled}
        testID="interactive-view-zoom-out"
      />
      <ViewCommandButton
        label="Zoom in"
        Icon={ThemedZoomIn}
        command={ZOOM_IN}
        run={run}
        disabled={disabled}
        testID="interactive-view-zoom-in"
      />
      <ViewCommandButton
        label="Fit to view"
        Icon={ThemedFitScreen}
        command={FIT}
        run={run}
        disabled={disabled}
        testID="interactive-view-fit"
      />
      {state?.motion ? (
        <>
          <ToolbarSeparator />
          <ViewCommandButton
            label={motionLive ? "Pause motion" : "Play motion"}
            Icon={motionLive ? ThemedPause : ThemedPlay}
            command={MOTION}
            run={run}
            selected={motionLive}
            testID="interactive-view-motion"
          />
        </>
      ) : null}
      {isNative ? null : (
        <>
          <ToolbarSeparator />
          <InteractiveViewExportMenu controller={controller} />
        </>
      )}
    </>
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sourceStatusDotStyle(status: InteractiveViewSourceStatus) {
  if (status === "stale") return styles.dotWarning;
  if (status === "current") return styles.dotCurrent;
  return styles.dotUnknown;
}

function sourceStatusLabel(status: InteractiveViewSourceStatus): string {
  if (status === "stale") return "Source changed";
  if (status === "unknown") return "Source freshness unavailable";
  return "Current with Knowledge";
}

/**
 * Status-bar content for a View, following the File Editor strip: what the
 * document is on the left, how it is being read on the right. Read-only.
 */
export function InteractiveViewStatus({
  controller,
  diagramType,
  sourceStatus,
  leading,
}: {
  controller: InteractiveViewController;
  diagramType?: ArchitecturalViewDiagramType;
  sourceStatus?: InteractiveViewSourceStatus;
  /** Extra left-side facts, such as a Knowledge path. */
  leading?: string | null;
}): ReactElement {
  const { state } = controller;
  const facts: string[] = [];
  if (diagramType) facts.push(`${architecturalViewTypeLabel(diagramType)} View`);
  if (state) {
    facts.push(pluralize(state.components, "component", "components"));
    facts.push(pluralize(state.relationships, "relationship", "relationships"));
  }
  return (
    <View style={styles.status} testID="interactive-view-status">
      <View style={styles.statusGroup}>
        {leading ? (
          <Text numberOfLines={1} style={styles.statusText}>
            {leading}
          </Text>
        ) : null}
        {facts.length > 0 ? (
          <Text numberOfLines={1} style={styles.statusText}>
            {facts.join(" · ")}
          </Text>
        ) : null}
      </View>
      <View style={styles.statusGroup}>
        {sourceStatus ? (
          <View style={styles.statusItem}>
            <View style={sourceStatusDotStyle(sourceStatus)} />
            <Text numberOfLines={1} style={styles.statusText}>
              {sourceStatusLabel(sourceStatus)}
            </Text>
          </View>
        ) : null}
        {state ? (
          <Text style={styles.numericText}>{`${Math.round(state.scale * 100)}%`}</Text>
        ) : null}
      </View>
    </View>
  );
}

const STATUS_DOT = { width: 6, height: 6, borderRadius: 3 } as const;

const styles = StyleSheet.create((theme) => ({
  canvas: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.colors.surface0 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  status: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: 24,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...(isWeb ? ({ cursor: "default", userSelect: "none" } as object) : {}),
  },
  statusGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
    minWidth: 0,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  numericText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  dotCurrent: { ...STATUS_DOT, backgroundColor: theme.colors.statusSuccess },
  dotWarning: { ...STATUS_DOT, backgroundColor: theme.colors.statusWarning },
  dotUnknown: { ...STATUS_DOT, backgroundColor: theme.colors.foregroundMuted },
}));
