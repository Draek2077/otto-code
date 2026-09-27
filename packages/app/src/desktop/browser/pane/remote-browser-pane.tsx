import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  createFixedBrowserViewport,
  normalizeWorkspaceBrowserUrl,
  useBrowserStore,
  useBrowserStoreHydrated,
} from "../store";
import type {
  RemoteBrowserCommand,
  RemoteBrowserTab,
} from "@otto-code/protocol/browser-remote/rpc-schemas";

interface Props {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

const SIZES = [
  { label: "Fit", width: 0, height: 0 },
  { label: "Phone", width: 390, height: 844 },
  { label: "Tablet", width: 820, height: 1180 },
  { label: "Desktop", width: 1366, height: 768 },
] as const;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// The toolbar has many independent controls; stable callbacks matter less than
// avoiding redundant frame decode. The frame loop is serialized below.
/* eslint-disable react-perf/jsx-no-new-function-as-prop */
export function BrowserPane({
  browserId,
  serverId,
  workspaceId,
  isInteractive,
  onFocusPane,
}: Props) {
  const hydrated = useBrowserStoreHydrated();
  const browser = useBrowserStore((state) => state.browsersById[browserId] ?? null);
  const updateBrowser = useBrowserStore((state) => state.updateBrowser);
  const setViewport = useBrowserStore((state) => state.setBrowserViewport);
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.remoteBrowser === true,
  );
  const presented = useRetainedPanelActive() && isInteractive !== false;
  const [size, setSize] = useState({ width: 390, height: 700 });
  const [tab, setTab] = useState<RemoteBrowserTab | null>(null);
  const hasTab = Boolean(tab);
  const [image, setImage] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const editingAddress = useRef(false);
  const addressInput = useRef<EditingTextInputHandle>(null);
  const typeInput = useRef<EditingTextInputHandle>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const revision = useRef<number | undefined>(undefined);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const imageSource = useMemo(() => (image ? { uri: image } : undefined), [image]);
  const viewport = browser?.viewport;
  const effectiveViewport = useMemo(
    () =>
      viewport?.mode === "fixed"
        ? { mode: "fixed" as const, width: viewport.width, height: viewport.height }
        : {
            mode: "responsive" as const,
            width: Math.max(240, Math.round(size.width)),
            height: Math.max(240, Math.round(size.height)),
          },
    [viewport, size],
  );
  const displayViewport = tab?.viewport ?? effectiveViewport;

  useEffect(() => {
    if (hydrated && !browser) useBrowserStore.getState().ensureBrowser(browserId);
  }, [hydrated, browser, browserId]);

  const acceptTab = useCallback(
    (next: RemoteBrowserTab | undefined) => {
      if (!next) return;
      setTab(next);
      if (!editingAddress.current) {
        setAddress(next.url);
        addressInput.current?.replaceText(next.url);
      }
      updateBrowser(browserId, {
        url: next.url,
        title: next.title,
        lastError: next.error,
        isLoading: next.state === "starting",
      });
    },
    [browserId, updateBrowser],
  );

  const run = useCallback(
    async (command: RemoteBrowserCommand) => {
      if (!client || !connected)
        throw new Error("The host is disconnected. This tab will reconnect automatically.");
      const response = await client.remoteBrowserExecute(workspaceId, command);
      acceptTab(response.tab);
      return response;
    },
    [client, connected, workspaceId, acceptTab],
  );

  // Open is idempotent: the same tab ID reattaches to its existing page after
  // a socket loss, preserving scroll, forms and history while that page lives.
  useEffect(() => {
    if (!hydrated || !browser || !client || !connected || !supported) return;
    let live = true;
    setError(null);
    void client
      .remoteBrowserExecute(workspaceId, {
        kind: "open",
        browserId,
        url: browser.url,
        viewport: effectiveViewport,
      })
      .then((response) => {
        if (!live) return undefined;
        acceptTab(response.tab);
        if (response.tab?.viewport.mode === "fixed") {
          setViewport(
            browserId,
            createFixedBrowserViewport(response.tab.viewport.width, response.tab.viewport.height),
          );
        }
        revision.current = undefined;
        return undefined;
      })
      .catch((cause: unknown) => {
        if (live) setError(errorText(cause));
      });
    return () => {
      live = false;
    };
    // Viewport changes use the next effect; opening follows connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, Boolean(browser), client, connected, supported, workspaceId, browserId]);

  useEffect(() => {
    if (!hasTab || !connected || !supported) return;
    void run({ kind: "viewport", browserId, viewport: effectiveViewport }).catch((cause: unknown) =>
      setError(errorText(cause)),
    );
  }, [hasTab, connected, supported, effectiveViewport, run, browserId]);

  useEffect(() => {
    if (!presented || !hasTab || !client || !connected || !supported) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const poll = async () => {
      try {
        const response = await client.remoteBrowserExecute(workspaceId, {
          kind: "frame",
          browserId,
          knownRevision: revision.current,
        });
        if (live) {
          acceptTab(response.tab);
          if (response.frame) {
            revision.current = response.frame.revision;
            setImage(`data:image/jpeg;base64,${response.frame.dataBase64}`);
          }
          setError(response.tab?.error ?? null);
          failures = 0;
        }
      } catch (cause) {
        if (live) setError(errorText(cause));
        failures++;
      } finally {
        if (live)
          timer = setTimeout(
            () => void poll(),
            failures ? Math.min(15_000, 1_000 * 2 ** failures) : 900,
          );
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [presented, hasTab, client, connected, supported, workspaceId, browserId, acceptTab]);

  const act = useCallback(
    (command: RemoteBrowserCommand) => {
      setError(null);
      void run(command).catch((cause: unknown) => setError(errorText(cause)));
    },
    [run],
  );

  const onPagePress = useCallback(
    (event: GestureResponderEvent) => {
      onFocusPane?.();
      if (swiped.current) {
        swiped.current = false;
        return;
      }
      const { locationX, locationY } = event.nativeEvent;
      const { width: vw, height: vh } = displayViewport;
      const scale = Math.min(size.width / vw, size.height / vh);
      const x = (locationX - (size.width - vw * scale) / 2) / scale;
      const y = (locationY - (size.height - vh * scale) / 2) / scale;
      if (x >= 0 && y >= 0 && x <= vw && y <= vh) act({ kind: "tap", browserId, x, y });
    },
    [onFocusPane, displayViewport, size, act, browserId],
  );

  const onTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const start = touch.current;
      touch.current = null;
      const changed = event.nativeEvent.changedTouches?.[0];
      if (!start || !changed) return;
      const dx = changed.pageX - start.x;
      const dy = changed.pageY - start.y;
      if (Math.abs(dx) + Math.abs(dy) < 15) return;
      swiped.current = true;
      const scale = Math.min(
        size.width / displayViewport.width,
        size.height / displayViewport.height,
      );
      act({
        kind: "scroll",
        browserId,
        x: displayViewport.width / 2,
        y: displayViewport.height / 2,
        deltaX: -dx / scale,
        deltaY: -dy / scale,
      });
    },
    [act, browserId, displayViewport, size],
  );

  if (connected && !supported)
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Update the host to use mobile browser tabs.</Text>
      </View>
    );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => act({ kind: "back", browserId })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward"
          onPress={() => act({ kind: "forward", browserId })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload"
          onPress={() => act({ kind: "reload", browserId })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>↻</Text>
        </Pressable>
        <EditingTextInput
          ref={addressInput}
          accessibilityLabel="Address"
          initialValue={address}
          onChangeText={setAddress}
          onFocus={() => {
            editingAddress.current = true;
          }}
          onBlur={() => {
            editingAddress.current = false;
          }}
          onSubmitEditing={() => {
            const url = normalizeWorkspaceBrowserUrl(address);
            setAddress(url);
            act({ kind: "navigate", browserId, url });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
          style={styles.address}
        />
      </View>
      <View style={styles.devices}>
        {SIZES.map((preset) => (
          <Pressable
            key={preset.label}
            accessibilityRole="button"
            accessibilityLabel={`${preset.label} viewport`}
            onPress={() =>
              setViewport(
                browserId,
                preset.width
                  ? createFixedBrowserViewport(preset.width, preset.height)
                  : { mode: "responsive" },
              )
            }
            style={styles.device}
          >
            <Text style={styles.deviceText}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => act({ kind: "reload", browserId })}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {!connected ? (
        <Text style={styles.message}>
          Host disconnected. This tab will reconnect automatically.
        </Text>
      ) : null}
      <View
        style={styles.page}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width && height && (width !== size.width || height !== size.height))
            setSize({ width, height });
        }}
      >
        {image ? (
          <Pressable
            style={styles.imagePress}
            onPress={onPagePress}
            onTouchStart={(event) => {
              const point = event.nativeEvent.touches?.[0];
              if (point) touch.current = { x: point.pageX, y: point.pageY };
            }}
            onTouchEnd={onTouchEnd}
          >
            <Image source={imageSource} resizeMode="contain" style={styles.image} />
          </Pressable>
        ) : (
          <View style={styles.center}>
            <Text style={styles.message}>Connecting to host browser…</Text>
          </View>
        )}
      </View>
      <View style={styles.inputRow}>
        <EditingTextInput
          ref={typeInput}
          accessibilityLabel="Type into page"
          placeholder="Type into page"
          onChangeText={setTyped}
          onSubmitEditing={() => {
            if (typed) {
              act({ kind: "type", browserId, text: typed });
              setTyped("");
              typeInput.current?.reset();
            }
          }}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (typed) {
              act({ kind: "type", browserId, text: typed });
              setTyped("");
              typeInput.current?.reset();
            }
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Type</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => act({ kind: "key", browserId, key: "Enter" })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>↵</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 5,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  button: {
    minWidth: 34,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  buttonText: { color: theme.colors.foreground, fontSize: 18 },
  address: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    color: theme.colors.foreground,
    fontSize: 13,
  },
  devices: { flexDirection: "row", justifyContent: "center", gap: 4, paddingVertical: 3 },
  device: { paddingHorizontal: 10, paddingVertical: 5 },
  deviceText: { color: theme.colors.foregroundMuted, fontSize: 12 },
  page: { flex: 1, overflow: "hidden" },
  imagePress: { flex: 1 },
  image: { width: "100%", height: "100%" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  message: { color: theme.colors.foregroundMuted, textAlign: "center", padding: 8 },
  error: {
    padding: 8,
    backgroundColor: theme.colors.surface1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
  retry: { color: theme.colors.foreground, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: { flex: 1, minHeight: 34, color: theme.colors.foreground, paddingHorizontal: 8 },
}));
