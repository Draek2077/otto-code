import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  Search,
  Focus,
  Route,
  Map,
  ZoomOut,
  ZoomIn,
  Maximize,
  Pause,
  Play,
  Download,
  BookOpen,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  PaneContentToolbar,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Alert } from "@/components/ui/alert";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { buildInteractiveViewTheme } from "./view-theme";
import {
  prepareInteractiveViewDocument,
  type InteractiveViewCommand,
  type InteractiveViewExportFormat,
} from "./view-bridge";
import { ViewController } from "./view-controller";
import { ViewFrame } from "./frame";
import { exportArchitecturalView } from "./export";
import { styles } from "./styles";

const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const formats: ReadonlyArray<{ format: InteractiveViewExportFormat; label: string }> = [
  { format: "png", label: "PNG image" },
  { format: "jpeg", label: "JPEG image" },
  { format: "webp", label: "WebP image" },
  { format: "svg", label: "SVG diagram" },
  { format: "webm", label: "WebM motion recording" },
];
function Control({
  label,
  type,
  icon,
  run,
  disabled,
  selected,
}: {
  label: string;
  type: InteractiveViewCommand["type"];
  icon: LucideIcon;
  run(command: InteractiveViewCommand): void;
  disabled: boolean;
  selected?: boolean;
}) {
  const Icon = useMemo(() => withUnistyles(icon), [icon]);
  const press = useCallback(() => {
    if (type !== "theme" && type !== "export") run({ type });
  }, [type, run]);
  return (
    <ToolbarButton label={label} onPress={press} disabled={disabled} selected={selected}>
      <Icon size={16} uniProps={iconColor} />
    </ToolbarButton>
  );
}
function ExportItem({
  format,
  label,
  run,
}: {
  format: InteractiveViewExportFormat;
  label: string;
  run(command: InteractiveViewCommand): void;
}) {
  const press = useCallback(() => run({ type: "export", format }), [format, run]);
  return <DropdownMenuItem onSelect={press}>{label}</DropdownMenuItem>;
}
const DownloadIcon = withUnistyles(Download);
const CloseIcon = withUnistyles(X);
function ActiveViewer({ html, theme }: { html: string; theme: Theme }) {
  const [controller] = useState(() => new ViewController(globalThis.crypto.randomUUID()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const payload = useMemo(() => buildInteractiveViewTheme({ theme }), [theme]);
  const initial = useRef(payload);
  const document = useMemo(
    () => prepareInteractiveViewDocument(html, { ...initial.current, channel: controller.channel }),
    [html, controller],
  );
  const alive = useRef(true);
  useEffect(() => {
    controller.activate();
    alive.current = true;
    return () => {
      alive.current = false;
      controller.close();
    };
  }, [controller]);
  useEffect(() => {
    if (state.ready) void controller.run({ type: "theme", ...payload });
  }, [controller, state.ready, payload]);
  const run = useCallback(
    (command: InteractiveViewCommand) => {
      void controller.run(command).then(async (result) => {
        if (!alive.current || !result.ok || !result.file) return null;
        try {
          await exportArchitecturalView(result.file);
        } catch (error) {
          if (alive.current)
            controller.notice(
              error instanceof Error ? error.message : "Export could not be saved.",
            );
        }
        return null;
      });
    },
    [controller],
  );
  const dismiss = useCallback(() => controller.notice(null), [controller]);
  const current = state.state;
  return (
    <View style={styles.page}>
      <PaneContentToolbar style={styles.viewerToolbar} testID="architectural-view-toolbar">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ToolbarControls>
            <Control
              label="Find"
              type="find"
              icon={Search}
              selected={current?.finderOpen}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Semantic lens"
              type="lens"
              icon={Focus}
              selected={current?.lensOpen}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Trace route"
              type="route"
              icon={Route}
              selected={current?.routeOpen}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Overview map"
              type="map"
              icon={Map}
              selected={current?.mapOpen}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Diagram guide"
              type="guide"
              icon={BookOpen}
              selected={current?.guideOpen}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Zoom out"
              type="zoomOut"
              icon={ZoomOut}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Zoom in"
              type="zoomIn"
              icon={ZoomIn}
              run={run}
              disabled={!state.ready}
            />
            <Control
              label="Fit view"
              type="fit"
              icon={Maximize}
              run={run}
              disabled={!state.ready}
            />
            {current?.motion ? (
              <Control
                label={current.motion === "live" ? "Pause motion" : "Play motion"}
                type="motion"
                icon={current.motion === "live" ? Pause : Play}
                run={run}
                disabled={!state.ready}
              />
            ) : null}
            {isWeb ? (
              <DropdownMenu>
                <ToolbarButton kind="menu" label="Export diagram" disabled={!state.ready}>
                  <DownloadIcon size={16} uniProps={iconColor} />
                </ToolbarButton>
                <DropdownMenuContent>
                  {formats
                    .filter((entry) => entry.format !== "webm" || current?.motion)
                    .map((entry) => (
                      <ExportItem key={entry.format} {...entry} run={run} />
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </ToolbarControls>
        </ScrollView>
      </PaneContentToolbar>
      {state.notice ? (
        <View style={styles.row}>
          <View style={styles.spacer}>
            <Alert variant="warning" description={state.notice} />
          </View>
          <ToolbarButton label="Dismiss View notice" onPress={dismiss}>
            <CloseIcon size={14} uniProps={iconColor} />
          </ToolbarButton>
        </View>
      ) : null}
      <View style={styles.preview}>
        <ViewFrame
          html={document}
          channel={controller.channel}
          onMessage={controller.receive}
          onTransport={controller.transport}
        />
      </View>
      <View style={styles.status}>
        <Text style={styles.statusText}>
          {current
            ? `${Math.round(current.scale * 100)}% · ${current.components} components · ${current.relationships} relationships`
            : "Loading View..."}
        </Text>
      </View>
    </View>
  );
}
const ThemedViewer = withUnistyles(ActiveViewer);
const projection = (theme: Theme) => ({ theme });
/** Every surface uses this same isolated viewer. Hidden frames release their
 * guest clocks/transport; theme updates on an active frame preserve its camera. */
export function ArchitecturalViewer({ html, active }: { html: string; active: boolean }) {
  return active ? <ThemedViewer html={html} uniProps={projection} /> : <View style={styles.page} />;
}
