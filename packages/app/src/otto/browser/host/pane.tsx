import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useBrowserStore, normalizeWorkspaceBrowserUrl } from "@/desktop/browser/store";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { persistAttachmentFromDataUrl } from "@/attachments/service";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { BrowserAutomationCommand } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { HostBrowserViewer } from "./viewer-model";
import { HostBrowserFrame } from "./frame";
import { HostBrowserToolbar, HostBrowserTyping } from "./toolbar";
import { useHostBrowserClient, type HostBrowserClient } from "./client";
import { updateHostBrowser } from "./adopt";
import { styles } from "./styles";
import { hostPageScreenshot } from "./screenshot";
import { usePaneContext } from "@/panels/pane-context";
import { createHostedTab } from "./creation";
interface Props {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive: boolean;
  onFocusPane(): void;
}
export function HostBrowserPane(props: Props) {
  const client = useHostBrowserClient(props.serverId, props.workspaceId);
  if (!client)
    return (
      <View style={styles.message}>
        <Text style={styles.text}>Update and connect the host to use Host Browser.</Text>
      </View>
    );
  return <AvailableHostBrowserPane {...props} client={client} />;
}
function AvailableHostBrowserPane({ client, ...props }: Props & { client: HostBrowserClient }) {
  const { retargetCurrentTab } = usePaneContext();
  const browser = useBrowserStore((state) => state.browsersById[props.browserId]);
  const visible = useAppVisible(),
    retained = useRetainedPanelActive(),
    connected = useHostRuntimeIsConnected(props.serverId);
  const active = visible && retained && connected;
  const viewer = useMemo(
    () => new HostBrowserViewer(client.viewer(props.browserId)),
    [client, props.browserId],
  );
  const state = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot, viewer.getSnapshot);
  const [opening, setOpening] = useState(0),
    [typing, setTyping] = useState(false),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    authority = useRef<object | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [capturing, setCapturing] = useState(false),
    captureLock = useRef(false);
  useEffect(() => {
    if (!active) return;
    const owner = {};
    authority.current = owner;
    const hide = viewer.activate();
    return () => {
      if (authority.current === owner) authority.current = null;
      hide();
    };
  }, [active, opening, viewer]);
  const reconnect = useCallback(() => setOpening((value) => value + 1), []);
  const reopen = useCallback(() => {
    const owner = authority.current;
    if (!owner || lock.current || !browser) return;
    lock.current = true;
    setBusy(true);
    void (async () => {
      const target = await createHostedTab(client, props.serverId, browser.url);
      if (authority.current === owner)
        retargetCurrentTab({ kind: "browser", browserId: target.browserId });
    })()
      .catch(() => {
        if (authority.current === owner) setError("The host could not reopen this address.");
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, [browser, client, props.serverId, retargetCurrentTab]);
  const keyboard = useCallback(() => setTyping((value) => !value), []);
  const refresh = useCallback(async () => {
    const tabs = await client.list();
    for (const tab of tabs) if (tab.browserId === props.browserId) updateHostBrowser(tab);
  }, [client, props.browserId]);
  const run = useCallback(
    async (command: BrowserAutomationCommand) => {
      if (!authority.current || lock.current) return null;
      const owner = authority.current;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await client.command(command);
        if (authority.current === owner) await refresh();
        return result;
      } catch {
        if (authority.current === owner)
          setError(
            "The browser action was not acknowledged. Inspect the page and make a new explicit attempt.",
          );
        return null;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [client, refresh],
  );
  const act = useCallback(
    (command: BrowserAutomationCommand) => {
      if (command.command === "navigate")
        command = {
          ...command,
          args: { ...command.args, url: normalizeWorkspaceBrowserUrl(command.args.url) },
        };
      void run(command);
    },
    [run],
  );
  const screenshot = useCallback(() => {
    const owner = authority.current;
    if (!owner || captureLock.current || lock.current) return;
    captureLock.current = true;
    setCapturing(true);
    void (async () => {
      const result = await run({
        command: "screenshot",
        args: { browserId: props.browserId, fullPage: false },
      });
      if (!owner || authority.current !== owner || result?.command !== "screenshot" || !props.cwd)
        return;
      const metadata = await persistAttachmentFromDataUrl({
        dataUrl: `data:${result.mimeType};base64,${result.dataBase64}`,
        mimeType: result.mimeType,
        fileName: "host-browser.png",
      });
      if (authority.current !== owner) return;
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey: buildWorkspaceAttachmentScopeKey({
          serverId: props.serverId,
          workspaceId: props.workspaceId,
          cwd: props.cwd,
        }),
        attachment: {
          kind: "browser_element",
          attachment: hostPageScreenshot({
            url: useBrowserStore.getState().browsersById[props.browserId]?.url ?? "about:blank",
            width: viewer.getSnapshot().frame?.viewportWidth ?? result.width,
            height: viewer.getSnapshot().frame?.viewportHeight ?? result.height,
            screenshot: metadata,
          }),
        },
      });
    })()
      .catch(() => {
        if (authority.current === owner) setError("The page screenshot could not be attached.");
      })
      .finally(() => {
        captureLock.current = false;
        setCapturing(false);
      });
  }, [props.browserId, props.cwd, props.serverId, props.workspaceId, run, viewer]);
  const displayed = useCallback((sequence: number) => viewer.displayed(sequence), [viewer]);
  const failed = useCallback((sequence: number) => viewer.decodeFailed(sequence), [viewer]);
  const input = useCallback(
    (event: Parameters<typeof viewer.input>[0]) => viewer.input(event),
    [viewer],
  );
  const send = useCallback((text: string) => viewer.type(text), [viewer]);
  const layout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);
  useEffect(() => {
    if (!active || size.width < 1 || size.height < 1) return;
    const viewport = browser?.viewport;
    const width = Math.max(
      1,
      Math.min(4096, Math.round(viewport?.mode === "fixed" ? viewport.width : size.width)),
    );
    const height = Math.max(
      1,
      Math.min(4096, Math.round(viewport?.mode === "fixed" ? viewport.height : size.height)),
    );
    const owner = authority.current;
    const timer = setTimeout(() => {
      void client
        .command({ command: "resize", args: { browserId: props.browserId, width, height } })
        .then(async () => {
          if (owner && authority.current === owner) await refresh();
          return;
        })
        .catch(() => {
          if (owner && authority.current === owner)
            setError("The host could not resize this page. Select a viewport again to retry.");
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [active, browser?.viewport, client, props.browserId, refresh, size.height, size.width]);
  if (!browser)
    return (
      <View style={styles.message}>
        <Text style={styles.text}>This browser tab is unavailable.</Text>
      </View>
    );
  return (
    <View style={styles.root} testID="otto-host-browser">
      <HostBrowserToolbar
        browser={browser}
        hostId={props.serverId}
        workspaceId={props.workspaceId}
        active={active}
        busy={busy || capturing || !active}
        act={act}
        screenshot={screenshot}
        reconnect={reconnect}
        keyboard={keyboard}
        report={setError}
      />
      {typing ? <HostBrowserTyping send={send} /> : null}
      {error ? (
        <View style={styles.feedback}>
          <Alert variant="error" description={error} />
        </View>
      ) : null}
      {browser.lastError ? (
        <View style={styles.feedback}>
          <Alert variant="warning" description={browser.lastError} />
        </View>
      ) : null}
      <View style={styles.frame} onLayout={layout}>
        {active && state.frame ? (
          <HostBrowserFrame
            frame={state.frame}
            displayed={displayed}
            failed={failed}
            input={input}
            focus={props.onFocusPane}
          />
        ) : (
          <View style={styles.message}>
            <Text style={styles.text}>
              {state.error ??
                (connected ? "Connecting to the host browser…" : "The host is disconnected.")}
            </Text>
            {state.phase === "error" || state.phase === "ended" ? (
              <Button variant="outline" onPress={reconnect}>
                Reconnect viewer
              </Button>
            ) : null}
            {state.phase === "error" || state.phase === "ended" ? (
              <Button variant="outline" onPress={reopen} disabled={busy}>
                Reopen address in a new host tab
              </Button>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
