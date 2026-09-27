import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Devices,
  RotateCw,
  Send,
} from "@/components/icons/material-icons";
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
import { RemoteBrowserFrame, type RemoteBrowserFrameHandle } from "./remote-browser-frame";
import { useHostedPreviewGate } from "./hosted-preview-gate";

interface Props {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

const SIZES = [
  { id: "responsive", width: 0, height: 0 },
  { id: "phone", width: 390, height: 844 },
  { id: "tablet", width: 820, height: 1180 },
  { id: "desktop", width: 1366, height: 768 },
] as const;

const ThemedDevices = withUnistyles(Devices);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSend = withUnistyles(Send);
const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const mutedIcon = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

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
  const { t } = useTranslation();
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
  const previewGate = useHostedPreviewGate({ browserId, serverId });
  const previewPending = previewGate.pending;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measured = size.width > 0 && size.height > 0;
  const [tab, setTab] = useState<RemoteBrowserTab | null>(null);
  const hasTab = Boolean(tab);
  const [hasFrame, setHasFrame] = useState(false);
  const frameRef = useRef<RemoteBrowserFrameHandle>(null);
  const [address, setAddress] = useState("");
  const editingAddress = useRef(false);
  const addressInput = useRef<EditingTextInputHandle>(null);
  const typeInput = useRef<EditingTextInputHandle>(null);
  const [typed, setTyped] = useState("");
  // An action's failure stays until the next action. A poll failure clears on
  // the next good poll, so it must not erase the action's message.
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const revision = useRef<number | undefined>(undefined);
  const touch = useRef<{
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const swiped = useRef(false);
  const fastFrames = useRef(false);
  const wakeFramePoll = useRef<(() => void) | null>(null);
  const scrollCooldown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollPending = useRef({ x: 0, y: 0 });
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollBusy = useRef(false);
  const scrollMounted = useRef(true);
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
  const selectedSize = SIZES.find((preset) =>
    preset.width
      ? displayViewport.mode === "fixed" &&
        displayViewport.width === preset.width &&
        displayViewport.height === preset.height
      : displayViewport.mode === "responsive",
  );

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
        renderMode: "hosted",
        url: next.url,
        title: next.title,
        lastError: next.error,
        isLoading: next.state === "starting",
        viewport:
          next.viewport.mode === "fixed"
            ? createFixedBrowserViewport(next.viewport.width, next.viewport.height)
            : { mode: "responsive" },
      });
    },
    [browserId, updateBrowser],
  );

  const run = useCallback(
    async (command: RemoteBrowserCommand) => {
      if (!client || !connected) throw new Error(t("workspace.browser.hosted.disconnected"));
      const response = await client.remoteBrowserExecute(workspaceId, command);
      acceptTab(response.tab);
      return response;
    },
    [client, connected, workspaceId, acceptTab, t],
  );

  const hasBrowser = Boolean(browser);
  // Open is idempotent: the same tab ID reattaches to its existing page after
  // a socket loss, preserving scroll, forms and history while that page lives.
  useEffect(() => {
    if (!hydrated || !browser || !client || !connected || !supported || !measured) return;
    // A preview tab has no page to show until its dev server is up.
    if (previewPending) return;
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
        revision.current = undefined;
        return undefined;
      })
      .catch((cause: unknown) => {
        if (live) setError(errorText(cause));
      });
    return () => {
      live = false;
    };
    // Opening follows connection changes; existing host viewport wins on attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    hasBrowser,
    client,
    connected,
    supported,
    measured,
    previewPending,
    workspaceId,
    browserId,
  ]);

  useEffect(() => {
    if (!presented || !hasTab || !client || !connected || !supported) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let failures = 0;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await client.remoteBrowserExecute(workspaceId, {
          kind: "frame",
          browserId,
          knownRevision: revision.current,
        });
        if (live) {
          acceptTab(response.tab);
          if (response.frame) {
            await frameRef.current?.present(response.frame.dataBase64);
            revision.current = response.frame.revision;
            setHasFrame(true);
          }
          setPollError(null);
          failures = 0;
        }
      } catch (cause) {
        if (live) setPollError(errorText(cause));
        failures++;
      } finally {
        polling = false;
        if (live) {
          let delay = fastFrames.current ? 150 : 900;
          if (failures) delay = Math.min(15_000, 1_000 * 2 ** failures);
          timer = setTimeout(() => void poll(), delay);
        }
      }
    };
    wakeFramePoll.current = () => {
      if (!live || polling) return;
      if (timer) clearTimeout(timer);
      timer = null;
      void poll();
    };
    void poll();
    return () => {
      live = false;
      wakeFramePoll.current = null;
      if (timer) clearTimeout(timer);
    };
  }, [presented, hasTab, client, connected, supported, workspaceId, browserId, acceptTab]);

  const flushScroll = useCallback(() => {
    if (!scrollMounted.current || scrollBusy.current || !client || !connected) return;
    const pending = scrollPending.current;
    if (!pending.x && !pending.y) return;
    scrollPending.current = { x: 0, y: 0 };
    scrollBusy.current = true;
    void client
      .remoteBrowserExecute(workspaceId, {
        kind: "scroll",
        browserId,
        x: displayViewport.width / 2,
        y: displayViewport.height / 2,
        deltaX: pending.x,
        deltaY: pending.y,
      })
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => {
        scrollBusy.current = false;
        if (scrollMounted.current && (scrollPending.current.x || scrollPending.current.y)) {
          scrollTimer.current = setTimeout(() => {
            scrollTimer.current = null;
            flushScroll();
          }, 0);
        }
      });
  }, [client, connected, workspaceId, browserId, displayViewport]);

  const queueScroll = useCallback(
    (dx: number, dy: number) => {
      const scale = Math.min(
        size.width / displayViewport.width,
        size.height / displayViewport.height,
      );
      scrollPending.current.x -= dx / scale;
      scrollPending.current.y -= dy / scale;
      if (!scrollTimer.current) {
        scrollTimer.current = setTimeout(() => {
          scrollTimer.current = null;
          flushScroll();
        }, 50);
      }
    },
    [size, displayViewport, flushScroll],
  );

  useEffect(() => {
    scrollMounted.current = true;
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (scrollCooldown.current) clearTimeout(scrollCooldown.current);
      scrollMounted.current = false;
      scrollTimer.current = null;
      scrollCooldown.current = null;
      scrollPending.current = { x: 0, y: 0 };
      fastFrames.current = false;
    };
  }, []);

  const act = useCallback(
    (command: RemoteBrowserCommand) => {
      setError(null);
      void run(command).catch((cause: unknown) => setError(errorText(cause)));
    },
    [run],
  );

  const claimViewport = useCallback(() => {
    if (!tab) return;
    if (
      tab.viewport.mode === effectiveViewport.mode &&
      tab.viewport.width === effectiveViewport.width &&
      tab.viewport.height === effectiveViewport.height
    )
      return;
    act({ kind: "viewport", browserId, viewport: effectiveViewport });
  }, [tab, effectiveViewport, act, browserId]);

  const onPagePress = useCallback(
    (event: GestureResponderEvent) => {
      onFocusPane?.();
      claimViewport();
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
    [onFocusPane, claimViewport, displayViewport, size, act, browserId],
  );

  const onTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const gesture = touch.current;
      const point = event.nativeEvent.touches?.[0];
      if (!gesture || !point) return;
      if (
        !gesture.moved &&
        Math.abs(point.pageX - gesture.x) + Math.abs(point.pageY - gesture.y) < 15
      )
        return;
      if (!gesture.moved) {
        gesture.moved = true;
        swiped.current = true;
        fastFrames.current = true;
        wakeFramePoll.current?.();
      }
      queueScroll(point.pageX - gesture.lastX, point.pageY - gesture.lastY);
      gesture.lastX = point.pageX;
      gesture.lastY = point.pageY;
    },
    [queueScroll],
  );

  const onTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const gesture = touch.current;
      touch.current = null;
      const point = event.nativeEvent.changedTouches?.[0];
      if (!gesture || !point) return;
      const moved =
        gesture.moved ||
        Math.abs(point.pageX - gesture.x) + Math.abs(point.pageY - gesture.y) >= 15;
      if (!moved) return;
      swiped.current = true;
      fastFrames.current = true;
      wakeFramePoll.current?.();
      queueScroll(point.pageX - gesture.lastX, point.pageY - gesture.lastY);
      if (scrollCooldown.current) clearTimeout(scrollCooldown.current);
      scrollCooldown.current = setTimeout(() => {
        fastFrames.current = false;
      }, 1_200);
    },
    [queueScroll],
  );

  const onTouchCancel = useCallback(() => {
    touch.current = null;
    if (scrollCooldown.current) clearTimeout(scrollCooldown.current);
    scrollCooldown.current = setTimeout(() => {
      fastFrames.current = false;
    }, 1_200);
  }, []);

  const onWheel = useCallback(
    (deltaX: number, deltaY: number) => {
      claimViewport();
      fastFrames.current = true;
      wakeFramePoll.current?.();
      queueScroll(-deltaX, -deltaY);
      if (scrollCooldown.current) clearTimeout(scrollCooldown.current);
      scrollCooldown.current = setTimeout(() => {
        fastFrames.current = false;
      }, 1_200);
    },
    [claimViewport, queueScroll],
  );

  const onKeyInput = useCallback(
    (value: string, kind: "text" | "key") => {
      claimViewport();
      if (kind === "text") act({ kind: "type", browserId, text: value });
      else act({ kind: "key", browserId, key: value });
    },
    [claimViewport, act, browserId],
  );

  // One control serves both inputs a page needs: text, then Enter. An empty
  // field sends Enter so a form can be submitted without a second button.
  const sendTyped = useCallback(() => {
    claimViewport();
    if (!typed) {
      act({ kind: "key", browserId, key: "Enter" });
      return;
    }
    act({ kind: "type", browserId, text: typed });
    setTyped("");
    typeInput.current?.reset();
  }, [claimViewport, typed, act, browserId]);

  // A phone has no key events for the page itself. Backspace in an empty field
  // has nothing local to delete, so it goes to the page.
  const onTypeKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Backspace" || typed) return;
      claimViewport();
      act({ kind: "key", browserId, key: "Backspace" });
    },
    [typed, claimViewport, act, browserId],
  );

  if (connected && !supported)
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t("workspace.browser.updateHost")}</Text>
      </View>
    );

  const shownError = error ?? pollError ?? tab?.error ?? null;
  const canGoBack = tab?.canGoBack === true;
  const canGoForward = tab?.canGoForward === true;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.back")}
          disabled={!canGoBack}
          onPress={() => act({ kind: "back", browserId })}
          style={[styles.button, !canGoBack && styles.buttonDisabled]}
        >
          <ThemedArrowLeft size={18} uniProps={mutedIcon} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.forward")}
          disabled={!canGoForward}
          onPress={() => act({ kind: "forward", browserId })}
          style={[styles.button, !canGoForward && styles.buttonDisabled]}
        >
          <ThemedArrowRight size={18} uniProps={mutedIcon} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.refresh")}
          onPress={() => act({ kind: "reload", browserId })}
          style={styles.button}
        >
          <ThemedRotateCw size={18} uniProps={mutedIcon} />
        </Pressable>
        <ThemedTextInput
          ref={addressInput}
          accessibilityLabel={t("workspace.browser.hosted.address")}
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
        <DropdownMenu>
          <DropdownMenuTrigger
            accessibilityLabel={t("workspace.browser.devices.label")}
            style={styles.button}
          >
            <View style={styles.viewportTrigger}>
              <ThemedDevices size={18} uniProps={mutedIcon} />
              <ThemedChevronDown size={12} uniProps={mutedIcon} />
            </View>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" minWidth={180}>
            {SIZES.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                selected={selectedSize === preset}
                showSelectedCheck
                onSelect={() => {
                  const nextViewport = preset.width
                    ? createFixedBrowserViewport(preset.width, preset.height)
                    : { mode: "responsive" as const };
                  setViewport(browserId, nextViewport);
                  act({
                    kind: "viewport",
                    browserId,
                    viewport:
                      nextViewport.mode === "fixed"
                        ? nextViewport
                        : {
                            mode: "responsive",
                            width: Math.max(240, Math.round(size.width)),
                            height: Math.max(240, Math.round(size.height)),
                          },
                  });
                }}
              >
                {t(`workspace.browser.hosted.sizes.${preset.id}`)}
                {preset.width ? ` · ${preset.width}×${preset.height}` : ""}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {shownError ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{shownError}</Text>
          <Pressable accessibilityRole="button" onPress={() => act({ kind: "reload", browserId })}>
            <Text style={styles.retry}>{t("common.actions.retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {!connected ? (
        <Text style={styles.message}>{t("workspace.browser.hosted.disconnected")}</Text>
      ) : null}
      <View
        style={styles.page}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width && height && (width !== size.width || height !== size.height))
            setSize({ width, height });
        }}
      >
        {previewGate.overlay}
        <Pressable
          style={previewPending ? styles.hidden : styles.imagePress}
          onPress={onPagePress}
          onTouchStart={(event) => {
            claimViewport();
            const point = event.nativeEvent.touches?.[0];
            swiped.current = false;
            if (scrollCooldown.current) clearTimeout(scrollCooldown.current);
            if (point)
              touch.current = {
                x: point.pageX,
                y: point.pageY,
                lastX: point.pageX,
                lastY: point.pageY,
                moved: false,
              };
          }}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <RemoteBrowserFrame
            ref={frameRef}
            width={size.width}
            height={size.height}
            onWheel={onWheel}
            onKeyInput={onKeyInput}
          />
          {!hasFrame ? (
            <View pointerEvents="none" style={styles.framePlaceholder}>
              <Text style={styles.message}>{t("workspace.browser.hosted.connecting")}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <View style={styles.inputRow}>
        <ThemedTextInput
          ref={typeInput}
          accessibilityLabel={t("workspace.browser.hosted.typeIntoPage")}
          placeholder={t("workspace.browser.hosted.typeIntoPage")}
          onChangeText={setTyped}
          onKeyPress={onTypeKeyPress}
          onSubmitEditing={sendTyped}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          submitBehavior="submit"
          style={styles.address}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.hosted.sendToPage")}
          onPress={sendTyped}
          style={styles.button}
        >
          <ThemedSend size={18} uniProps={mutedIcon} />
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
  buttonDisabled: { opacity: 0.45 },
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
  viewportTrigger: { flexDirection: "row", alignItems: "center", gap: 2 },
  page: { flex: 1, overflow: "hidden" },
  imagePress: { flex: 1 },
  hidden: { display: "none" },
  framePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
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
    gap: 4,
    padding: 5,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
}));
