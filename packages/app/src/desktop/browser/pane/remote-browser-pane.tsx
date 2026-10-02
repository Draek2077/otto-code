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
  ChevronDown,
  Devices,
  RotateCw,
  Send,
  Square,
} from "@/components/icons/material-icons";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import {
  createFixedBrowserViewport,
  normalizeWorkspaceBrowserUrl,
  useBrowserStore,
  useBrowserStoreHydrated,
} from "../store";
import {
  REMOTE_BROWSER_TYPE_TEXT_MAX,
  type RemoteBrowserCommand,
  type RemoteBrowserTab,
} from "@otto-code/protocol/browser-remote/rpc-schemas";
import { RemoteBrowserFrame, type RemoteBrowserFrameHandle } from "./remote-browser-frame";
import { pagePointFromPane, pressPointInPane } from "./hosted-page-point";
import { cancelHostedTap, queueHostedTap, type PendingTap } from "./hosted-tap-sequence";
import {
  advanceTouch,
  beginTouch,
  endTouch,
  scrollDeltaForDrag,
  type TouchDelta,
  type TouchGesture,
} from "./hosted-touch-gesture";
import { useHostedPreviewGate } from "./hosted-preview-gate";
import { useHostedStreamMeter } from "./use-hosted-stream-meter";
import { BrowserHostToggle } from "./browser-host-toggle";
import {
  FRAME_LONG_POLL_MS,
  nextFramePollDelayMs,
} from "@otto-code/protocol/browser-remote/frame-pacing";

interface Props {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
  onToggleHostMode?: () => void;
  hostModeToggleDisabled?: boolean;
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
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedSquare = withUnistyles(Square);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const mutedIcon = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function loadingForCommand(command: RemoteBrowserCommand): boolean | null {
  switch (command.kind) {
    case "navigate":
    case "back":
    case "forward":
    case "reload":
      return true;
    case "stop":
      return false;
    default:
      return null;
  }
}

function PaneNotices({
  error,
  connected,
  onRetry,
}: {
  error: string | null;
  connected: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.retry}>{t("common.actions.retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {!connected ? (
        <Text style={styles.message}>{t("workspace.browser.hosted.disconnected")}</Text>
      ) : null}
    </>
  );
}

function StreamMeterLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Text style={styles.meter} numberOfLines={1}>
      {text}
    </Text>
  );
}

// The toolbar has many independent controls; stable callbacks matter less than
// avoiding redundant frame decode. The frame loop is serialized below.
/* eslint-disable react-perf/jsx-no-new-function-as-prop */
// The hosted pane coordinates controls, frame delivery, and page input in one mounted surface.
// eslint-disable-next-line complexity
export function BrowserPane({
  browserId,
  serverId,
  workspaceId,
  isInteractive,
  onFocusPane,
  onToggleHostMode,
  hostModeToggleDisabled,
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
  // COMPAT(remoteBrowserLoadStatus): added in v0.9.26, remove gate after 2027-03-27.
  const supportsLoadStatus = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.remoteBrowserLoadStatus === true,
  );
  // COMPAT(remoteBrowserGestures): added in v0.9.28, remove gate after 2027-03-29.
  const supportsGestures = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.remoteBrowserGestures === true,
  );
  // A tab nobody can see asks for nothing: not behind another tab, and not
  // while the app itself is in the background.
  const appVisible = useAppVisible();
  const presented = useRetainedPanelActive() && isInteractive !== false && appVisible;
  const { text: meterText, recordFrame, recordHost } = useHostedStreamMeter(presented);
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
  const observationId = useRef(0);
  const navigationAction = useRef(0);
  const pendingLoadAction = useRef<{ id: number; loading: boolean } | null>(null);
  const touch = useRef<TouchGesture | null>(null);
  const swiped = useRef(false);
  const longPressed = useRef(false);
  // Mobile web may raise both contextmenu and onLongPress for one held finger.
  const lastTouchContextMenu = useRef(0);
  const pendingTap = useRef<PendingTap | null>(null);
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
      if (next.observationId !== undefined && next.observationId < observationId.current) return;
      if (next.observationId !== undefined) observationId.current = next.observationId;
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
        isLoading: supportsLoadStatus
          ? (pendingLoadAction.current?.loading ?? next.isLoading === true)
          : next.state === "starting",
        viewport:
          next.viewport.mode === "fixed"
            ? createFixedBrowserViewport(next.viewport.width, next.viewport.height)
            : { mode: "responsive" },
      });
    },
    [browserId, supportsLoadStatus, updateBrowser],
  );

  const run = useCallback(
    async (command: RemoteBrowserCommand, loadActionId?: number) => {
      if (!client || !connected) throw new Error(t("workspace.browser.hosted.disconnected"));
      const response = await client.remoteBrowserExecute(workspaceId, command);
      if (loadActionId === pendingLoadAction.current?.id) pendingLoadAction.current = null;
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
    observationId.current = 0;
    pendingLoadAction.current = null;
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
    let failures = 0;
    // One request at a time. The host holds it until the page repaints, so a
    // still page costs nothing and a slow link lowers the frame rate instead
    // of building a queue.
    const poll = async () => {
      const requestedAt = Date.now();
      let receivedFrame = false;
      try {
        const response = await client.remoteBrowserExecute(workspaceId, {
          kind: "frame",
          browserId,
          knownRevision: revision.current,
          waitMs: FRAME_LONG_POLL_MS,
        });
        if (live) {
          acceptTab(response.tab);
          if (response.stream) recordHost(response.stream);
          if (response.frame) {
            receivedFrame = true;
            const presentedAt = Date.now();
            const picture = response.frame.image ?? response.frame.dataBase64 ?? "";
            await frameRef.current?.present(picture);
            recordFrame({
              at: presentedAt,
              bytes: typeof picture === "string" ? picture.length : picture.byteLength,
              presentMs: Date.now() - presentedAt,
            });
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
        if (live) {
          const delay = failures
            ? Math.min(15_000, 1_000 * 2 ** failures)
            : nextFramePollDelayMs({ receivedFrame, elapsedMs: Date.now() - requestedAt });
          timer = setTimeout(() => void poll(), delay);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    presented,
    hasTab,
    client,
    connected,
    supported,
    workspaceId,
    browserId,
    acceptTab,
    recordFrame,
    recordHost,
  ]);

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
    (delta: TouchDelta) => {
      const scrolled = scrollDeltaForDrag(delta, size, displayViewport);
      scrollPending.current.x += scrolled.dx;
      scrollPending.current.y += scrolled.dy;
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
      scrollMounted.current = false;
      scrollTimer.current = null;
      scrollPending.current = { x: 0, y: 0 };
    };
  }, []);

  const act = useCallback(
    (command: RemoteBrowserCommand) => {
      setError(null);
      const loading = supportsLoadStatus ? loadingForCommand(command) : null;
      const action = loading === null ? navigationAction.current : ++navigationAction.current;
      if (loading !== null) {
        pendingLoadAction.current = { id: action, loading };
        updateBrowser(browserId, { isLoading: loading, lastError: null });
      }
      void run(command, loading === null ? undefined : action).catch((cause: unknown) => {
        if (action !== navigationAction.current) return;
        pendingLoadAction.current = null;
        if (loading !== null) updateBrowser(browserId, { isLoading: false });
        setError(errorText(cause));
      });
    },
    [browserId, run, supportsLoadStatus, updateBrowser],
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

  useEffect(
    () => () => {
      cancelHostedTap(pendingTap);
    },
    [],
  );

  const sendTap = useCallback(
    (point: { x: number; y: number }, button: "left" | "right", clickCount: 1 | 2 = 1) => {
      onFocusPane?.();
      claimViewport();
      act({ kind: "tap", browserId, ...point, button, clickCount });
    },
    [onFocusPane, claimViewport, act, browserId],
  );

  const cancelPendingTap = useCallback(() => {
    cancelHostedTap(pendingTap);
  }, []);

  const queueTap = useCallback(
    (point: { x: number; y: number }) => {
      if (!supportsGestures) {
        onFocusPane?.();
        claimViewport();
        act({ kind: "tap", browserId, ...point });
        return;
      }
      queueHostedTap(pendingTap, point, (tap, count) => sendTap(tap, "left", count));
    },
    [supportsGestures, onFocusPane, claimViewport, act, browserId, sendTap],
  );

  const onPagePress = useCallback(
    (event: GestureResponderEvent) => {
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      if (swiped.current) {
        swiped.current = false;
        return;
      }
      const pressed = pressPointInPane(event);
      const point = pressed && pagePointFromPane(pressed, size, displayViewport);
      if (point) queueTap(point);
    },
    [displayViewport, size, queueTap],
  );

  const onPageLongPress = useCallback(
    (event: GestureResponderEvent) => {
      if (!supportsGestures || !touch.current || swiped.current || touch.current.moved) return;
      const pressed = pressPointInPane(event);
      const point = pressed && pagePointFromPane(pressed, size, displayViewport);
      if (!point) return;
      longPressed.current = true;
      if (Date.now() - lastTouchContextMenu.current < 700) return;
      cancelPendingTap();
      sendTap(point, "right");
    },
    [supportsGestures, size, displayViewport, cancelPendingTap, sendTap],
  );

  const onPageContextMenu = useCallback(
    (pressed: { x: number; y: number }) => {
      if (!supportsGestures || longPressed.current) return;
      const point = pagePointFromPane(pressed, size, displayViewport);
      if (!point) return;
      if (touch.current) lastTouchContextMenu.current = Date.now();
      cancelPendingTap();
      sendTap(point, "right");
    },
    [supportsGestures, size, displayViewport, cancelPendingTap, sendTap],
  );

  // A drag scrolls the page and cancels the tap the press would otherwise be.
  const onTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const gesture = touch.current;
      const point = event.nativeEvent.touches?.[0];
      if (!gesture || !point) return;
      const delta = advanceTouch(gesture, point);
      if (!delta) return;
      swiped.current = true;
      queueScroll(delta);
    },
    [queueScroll],
  );

  const onTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const gesture = touch.current;
      touch.current = null;
      const point = event.nativeEvent.changedTouches?.[0];
      if (!gesture || !point) return;
      const delta = endTouch(gesture, point);
      if (!delta) return;
      swiped.current = true;
      queueScroll(delta);
    },
    [queueScroll],
  );

  const onTouchCancel = useCallback(() => {
    touch.current = null;
  }, []);

  const onWheel = useCallback(
    (deltaX: number, deltaY: number) => {
      claimViewport();
      queueScroll({ dx: -deltaX, dy: -deltaY });
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

  // Every route text takes into the page ends here - the send bar, and Ctrl+V
  // over the page - clamped to what one command may carry. The page puts it
  // wherever it has focus, which is the field the viewer last clicked.
  const typeIntoPage = useCallback(
    (text: string) => {
      claimViewport();
      act({ kind: "type", browserId, text: text.slice(0, REMOTE_BROWSER_TYPE_TEXT_MAX) });
    },
    [claimViewport, act, browserId],
  );

  // One control serves both inputs a page needs: text, then Enter. An empty
  // field sends Enter so a form can be submitted without a second button.
  const sendTyped = useCallback(() => {
    if (!typed) {
      claimViewport();
      act({ kind: "key", browserId, key: "Enter" });
      return;
    }
    typeIntoPage(typed);
    setTyped("");
    typeInput.current?.reset();
  }, [claimViewport, typed, act, browserId, typeIntoPage]);

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

  const canGoBack = tab?.canGoBack === true;
  const canGoForward = tab?.canGoForward === true;
  const isPageLoading = supportsLoadStatus && browser?.isLoading === true;

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
          <ThemedArrowLeft size={18} style={styles.forwardArrow} uniProps={mutedIcon} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isPageLoading
              ? t("workspace.browser.controls.stopLoading")
              : t("workspace.browser.controls.refresh")
          }
          onPress={() => act({ kind: isPageLoading ? "stop" : "reload", browserId })}
          style={styles.button}
        >
          {isPageLoading ? (
            <ThemedSquare size={18} uniProps={mutedIcon} />
          ) : (
            <ThemedRotateCw size={18} uniProps={mutedIcon} />
          )}
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
        {onToggleHostMode ? (
          <BrowserHostToggle
            hosted
            disabled={hostModeToggleDisabled === true}
            onPress={onToggleHostMode}
          />
        ) : null}
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
      <PaneNotices
        error={error ?? pollError ?? tab?.error ?? null}
        connected={connected}
        onRetry={() => act({ kind: "reload", browserId })}
      />
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
          onLongPress={onPageLongPress}
          onTouchStart={(event) => {
            claimViewport();
            const point = event.nativeEvent.touches?.[0];
            swiped.current = false;
            longPressed.current = false;
            lastTouchContextMenu.current = 0;
            if (point) touch.current = beginTouch(point);
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
            onPasteText={typeIntoPage}
            onContextMenu={onPageContextMenu}
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
      <StreamMeterLine text={meterText} />
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
  forwardArrow: { transform: [{ rotate: "180deg" }] },
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
  // The page is not one big button, so the desktop keeps its arrow over it.
  imagePress: { flex: 1, cursor: "auto" },
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
  meter: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: 8,
    paddingVertical: 2,
    textAlign: "right",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 5,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
}));
