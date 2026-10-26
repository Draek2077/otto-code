import { memo, useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { ArrowLeft, ArrowRight, RotateCw, Camera, MoreHorizontal } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useBrowserHistoryPort } from "../history-client";
import { PreviewWorkspaceMenuItem } from "@/otto/preview/workspace-menu-item";
import type { BrowserAutomationCommand } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { BrowserRecord } from "@/desktop/browser/store";
import { HostBrowserAddress } from "./address";
import { styles } from "./styles";
import { HostBrowserViewport } from "./viewport";
import { BrowserHistoryModel } from "../history-model";
import { HostHistoryClear } from "./history-menu";
const Back = withUnistyles(ArrowLeft),
  Forward = withUnistyles(ArrowRight),
  Refresh = withUnistyles(RotateCw),
  Capture = withUnistyles(Camera),
  More = withUnistyles(MoreHorizontal);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export interface HostToolbarProps {
  browser: BrowserRecord;
  hostId: string;
  workspaceId: string;
  active: boolean;
  busy: boolean;
  act(command: BrowserAutomationCommand): void;
  screenshot(): void;
  reconnect(): void;
  keyboard(): void;
  report(message: string): void;
}
export const HostBrowserToolbar = memo(function HostBrowserToolbar(props: HostToolbarProps) {
  const { browser, act } = props;
  const historyPort = useBrowserHistoryPort(props.hostId, props.workspaceId);
  const history = useMemo(
    () => (historyPort ? new BrowserHistoryModel(historyPort) : null),
    [historyPort],
  );
  const back = useCallback(
    () => act({ command: "back", args: { browserId: browser.browserId } }),
    [act, browser.browserId],
  );
  const forward = useCallback(
    () => act({ command: "forward", args: { browserId: browser.browserId } }),
    [act, browser.browserId],
  );
  const reload = useCallback(
    () => act({ command: "reload", args: { browserId: browser.browserId } }),
    [act, browser.browserId],
  );
  const navigate = useCallback(
    (url: string) => act({ command: "navigate", args: { browserId: browser.browserId, url } }),
    [act, browser.browserId],
  );
  return (
    <View style={styles.bar}>
      <ToolbarButton label="Back" onPress={back} disabled={props.busy || !browser.canGoBack}>
        <Back size={16} uniProps={muted} />
      </ToolbarButton>
      <ToolbarButton
        label="Forward"
        onPress={forward}
        disabled={props.busy || !browser.canGoForward}
      >
        <Forward size={16} uniProps={muted} />
      </ToolbarButton>
      <ToolbarButton label="Reload" onPress={reload} disabled={props.busy}>
        <Refresh size={16} uniProps={muted} />
      </ToolbarButton>
      <HostBrowserAddress
        hostId={props.hostId}
        workspaceId={props.workspaceId}
        url={browser.url}
        title={browser.title}
        active={props.active}
        navigate={navigate}
        model={history}
      />
      <ToolbarButton
        label="Attach page screenshot"
        onPress={props.screenshot}
        disabled={props.busy}
      >
        <Capture size={16} uniProps={muted} />
      </ToolbarButton>
      <HostBrowserMore {...props} history={history} />
      <HostBrowserViewport browserId={browser.browserId} />
    </View>
  );
});
function HostBrowserMore({
  browser,
  hostId,
  workspaceId,
  reconnect,
  keyboard,
  report,
  busy,
  history,
}: HostToolbarProps & { history: BrowserHistoryModel | null }) {
  const copy = useCallback(() => {
    void copyToClipboard(browser.url).catch(() => report("The address could not be copied."));
  }, [browser.url, report]);
  return (
    <DropdownMenu>
      <ToolbarButton label="More" kind="menu">
        <More size={16} uniProps={muted} />
      </ToolbarButton>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onSelect={keyboard}>Type on page</DropdownMenuItem>
        <DropdownMenuItem onSelect={copy}>Copy address</DropdownMenuItem>
        <DropdownMenuItem onSelect={reconnect} disabled={busy}>
          Reconnect viewer
        </DropdownMenuItem>
        {history ? <HostHistoryClear model={history} /> : null}
        <PreviewWorkspaceMenuItem serverId={hostId} workspaceId={workspaceId} surface="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function HostBrowserTyping({ send }: { send(text: string): Promise<boolean> }) {
  const input = useRef<EditingTextInputHandle>(null);
  const [pending, setPending] = useState(false),
    sending = useRef(false),
    edits = useRef(0);
  const changed = useCallback(() => {
    edits.current++;
  }, []);
  const submit = useCallback(() => {
    const text = input.current?.getText() ?? "";
    if (sending.current || text.length > 16384) return;
    const revision = edits.current;
    sending.current = true;
    setPending(true);
    void send(text)
      .then((accepted) => {
        if (accepted && edits.current === revision) input.current?.reset();
        return;
      })
      .finally(() => {
        sending.current = false;
        setPending(false);
      });
  }, [send]);
  return (
    <View style={styles.bar}>
      <View style={styles.address}>
        <EditingTextInput
          ref={input}
          initialValue=""
          style={styles.input}
          accessibilityLabel="Text for focused page field"
          placeholder="Type into the selected page field"
          onSubmitEditing={submit}
          onChangeText={changed}
          autoFocus
        />
      </View>
      <Button size="sm" variant="outline" onPress={submit} disabled={pending} loading={pending}>
        Send
      </Button>
    </View>
  );
}
