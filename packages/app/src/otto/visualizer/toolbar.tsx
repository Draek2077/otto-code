import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import {
  Focus,
  Pin,
  PictureInPicture2,
  MoreHorizontal,
  Volume2,
  VolumeX,
  Expand,
  X,
  Play,
  Square,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SelectField } from "@/components/ui/select-field";
import type { Theme } from "@/styles/theme";
import type { VisualizerSession } from "@getpaseo/visualizer/contracts";
import type { VisualizerPreferences } from "./preferences";
import { ALL_VISUALIZER_CHATS } from "./projection";
import { visualizerStyles as styles } from "./styles";
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const FocusIcon = withUnistyles(Focus),
  PinIcon = withUnistyles(Pin),
  PipIcon = withUnistyles(PictureInPicture2),
  MoreIcon = withUnistyles(MoreHorizontal),
  SoundIcon = withUnistyles(Volume2),
  MutedIcon = withUnistyles(VolumeX),
  ExpandIcon = withUnistyles(Expand),
  CloseIcon = withUnistyles(X),
  PlayIcon = withUnistyles(Play),
  StopIcon = withUnistyles(Square);
export interface VisualizerToolbarProps {
  sessions: VisualizerSession[];
  selectedId: string | null;
  follow: boolean;
  preferences: VisualizerPreferences;
  canDemo: boolean;
  demo: boolean;
  compact?: boolean;
  opening: boolean;
  choose(value: string): void;
  pin(): void;
  fit(): void;
  toggleDemo(): void;
  save(patch: Partial<VisualizerPreferences>): void;
  expand?(): void;
  close?(): void;
}
const toggles = [
  { key: "visualizerPanelTimeline", label: "Timeline" },
  { key: "visualizerPanelFileAttention", label: "File activity" },
  { key: "visualizerPanelCostOverlay", label: "Reported cost" },
  { key: "visualizerPanelFailures", label: "Failures" },
  { key: "visualizerPanelStats", label: "Node statistics" },
  { key: "visualizerHudHidden", label: "Hide graph controls" },
] as const;
function ToggleItem({
  label,
  field,
  preferences,
  save,
}: {
  label: string;
  field: (typeof toggles)[number]["key"];
  preferences: VisualizerPreferences;
  save: VisualizerToolbarProps["save"];
}) {
  const toggle = useCallback(
    () => save({ [field]: !preferences[field] }),
    [save, preferences, field],
  );
  return (
    <DropdownMenuItem onSelect={toggle}>
      {preferences[field] ? "✓ " : ""}
      {label}
    </DropdownMenuItem>
  );
}
export function VisualizerToolbar(props: VisualizerToolbarProps) {
  const { preferences, save, sessions, selectedId, compact } = props;
  const options = useMemo(
    () => [
      { id: ALL_VISUALIZER_CHATS, value: ALL_VISUALIZER_CHATS, label: "All active chats" },
      ...sessions.map((session) => ({ id: session.id, value: session.id, label: session.label })),
    ],
    [sessions],
  );
  const display = useMemo(() => {
    const option = options.find((item) => item.value === selectedId);
    return option ? { label: option.label } : null;
  }, [options, selectedId]);
  const mute = useCallback(
    () => save({ visualizerSoundMuted: !preferences.visualizerSoundMuted }),
    [save, preferences.visualizerSoundMuted],
  );
  const pip = useCallback(
    () =>
      save({ visualizerPipOpen: true, visualizerBackgroundOpen: false, visualizerSurface: "pip" }),
    [save],
  );
  return (
    <PaneContentToolbar style={styles.toolbar} testID="visualizer-toolbar">
      {!compact ? (
        <SelectField
          label="Visualizer chat"
          value={selectedId}
          selectedDisplay={display}
          options={options}
          onChange={props.choose}
          placeholder="Choose a chat"
          emptyText="No open chats"
          field={false}
          size="sm"
        />
      ) : (
        <Text style={styles.text}>Visualizer</Text>
      )}
      <View style={styles.spacer} />
      <ToolbarButton
        label={props.follow ? "Pin current chat" : "Follow focused chat"}
        selected={!props.follow}
        onPress={props.pin}
      >
        <PinIcon size={14} uniProps={iconColor} />
      </ToolbarButton>
      <ToolbarButton label="Zoom to fit" onPress={props.fit}>
        <FocusIcon size={14} uniProps={iconColor} />
      </ToolbarButton>
      <ToolbarButton
        label={preferences.visualizerSoundMuted ? "Unmute graph effects" : "Mute graph effects"}
        onPress={mute}
      >
        {preferences.visualizerSoundMuted ? (
          <MutedIcon size={14} uniProps={iconColor} />
        ) : (
          <SoundIcon size={14} uniProps={iconColor} />
        )}
      </ToolbarButton>
      {!compact ? (
        <ToolbarButton label="Picture in picture" onPress={pip}>
          <PipIcon size={14} uniProps={iconColor} />
        </ToolbarButton>
      ) : null}
      {props.canDemo || props.demo ? (
        <ToolbarButton label={props.demo ? "Stop demo" : "Start demo"} onPress={props.toggleDemo}>
          {props.demo ? (
            <StopIcon size={14} uniProps={iconColor} />
          ) : (
            <PlayIcon size={14} uniProps={iconColor} />
          )}
        </ToolbarButton>
      ) : null}
      {compact ? (
        <PipOptions save={save} />
      ) : (
        <DropdownMenu>
          <ToolbarButton kind="menu" label="Visualizer options">
            <MoreIcon size={14} uniProps={iconColor} />
          </ToolbarButton>
          <DropdownMenuContent>
            {toggles.map((item) => (
              <ToggleItem
                key={item.key}
                field={item.key}
                label={item.label}
                preferences={preferences}
                save={save}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {props.expand ? (
        <ToolbarButton
          label={props.opening ? "Opening Visualizer…" : "Open Visualizer tab"}
          disabled={props.opening}
          onPress={props.expand}
        >
          <ExpandIcon size={14} uniProps={iconColor} />
        </ToolbarButton>
      ) : null}
      {props.close ? (
        <ToolbarButton label="Close Visualizer" onPress={props.close}>
          <CloseIcon size={14} uniProps={iconColor} />
        </ToolbarButton>
      ) : null}
    </PaneContentToolbar>
  );
}
function PipOptions({ save }: { save: VisualizerToolbarProps["save"] }) {
  const small = useCallback(() => save({ visualizerPipSize: "small" }), [save]);
  const medium = useCallback(() => save({ visualizerPipSize: "medium" }), [save]);
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label="Picture-in-picture options">
        <MoreIcon size={14} uniProps={iconColor} />
      </ToolbarButton>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={small}>Small Visualizer</DropdownMenuItem>
        <DropdownMenuItem onSelect={medium}>Medium Visualizer</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
