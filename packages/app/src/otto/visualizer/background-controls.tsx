import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Eye, EyeOff, Expand, PictureInPicture2, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Alert } from "@/components/ui/alert";
import { useAppSettings } from "@/hooks/use-settings";
import { openVisualizerPanel } from "./actions";
import type { Theme } from "@/styles/theme";
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const Show = withUnistyles(Eye),
  Hide = withUnistyles(EyeOff),
  ExpandIcon = withUnistyles(Expand),
  Pip = withUnistyles(PictureInPicture2),
  Close = withUnistyles(X);

export function VisualizerBackgroundControls({
  serverId,
  workspaceId,
  hidden,
  toggle,
}: {
  serverId: string;
  workspaceId: string;
  hidden: boolean;
  toggle(): void;
}) {
  const { updateSettings } = useAppSettings();
  const lock = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const perform = useCallback(
    async (action: "pip" | "tab" | "close") => {
      if (lock.current) return;
      lock.current = true;
      setPending(true);
      setError("");
      try {
        if (action === "tab") await openVisualizerPanel(serverId, workspaceId);
        else
          await updateSettings({
            visualizerBackgroundOpen: false,
            visualizerPipOpen: action === "pip",
            ...(action === "pip" ? { visualizerSurface: "pip" } : {}),
          });
      } catch {
        setError("The Visualizer placement could not be saved. Try again.");
      } finally {
        lock.current = false;
        setPending(false);
      }
    },
    [serverId, workspaceId, updateSettings],
  );
  const pip = useCallback(() => {
    void perform("pip");
  }, [perform]);
  const tab = useCallback(() => {
    void perform("tab");
  }, [perform]);
  const close = useCallback(() => {
    void perform("close");
  }, [perform]);
  return (
    <View style={styles.root} testID="visualizer-background-controls">
      {error ? <Alert variant="error" description={error} /> : null}
      <View style={styles.buttons}>
        <ToolbarButton
          label={hidden ? "Show conversation" : "Show Visualizer only"}
          onPress={toggle}
        >
          {hidden ? (
            <Show size={16} uniProps={iconColor} />
          ) : (
            <Hide size={16} uniProps={iconColor} />
          )}
        </ToolbarButton>
        <ToolbarButton label="Picture in picture" disabled={pending} onPress={pip}>
          <Pip size={16} uniProps={iconColor} />
        </ToolbarButton>
        <ToolbarButton label="Open Visualizer tab" disabled={pending} onPress={tab}>
          <ExpandIcon size={16} uniProps={iconColor} />
        </ToolbarButton>
        <ToolbarButton label="Close background Visualizer" disabled={pending} onPress={close}>
          <Close size={16} uniProps={iconColor} />
        </ToolbarButton>
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[1], maxWidth: 320 },
  buttons: {
    flexDirection: "row",
    alignSelf: "flex-end",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
}));
