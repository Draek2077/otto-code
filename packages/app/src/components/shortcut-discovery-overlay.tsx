import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Portal } from "@gorhom/portal";
import { isWeb } from "@/constants/platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { ShortcutDiscoveryBadge } from "@/components/shortcut-discovery-badge";
import { clampShortcutDiscoveryCoordinate } from "@/components/shortcut-discovery-position";
import {
  DEFAULT_FLOATING_PANEL_PORTAL_HOST,
  measureFloatingPanelPortalHost,
} from "@/components/ui/floating-panel-portal";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import {
  useShowCenteredShortcutDiscovery,
  useShowShortcutDiscovery,
} from "@/hooks/use-show-shortcut-badges";
import { resolveKeyboardFocusScope } from "@/keyboard/focus-scope";
import {
  buildEffectiveBindings,
  buildShortcutDiscoveryEntries,
} from "@/keyboard/keyboard-shortcuts";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";

type ShortcutDiscoveryAction = ReturnType<typeof buildShortcutDiscoveryEntries>[number]["action"];

interface ShortcutDiscoveryAnchor {
  action: ShortcutDiscoveryAction;
  /**
   * Narrows a shared dispatcher action to the binding(s) the visible control
   * actually handles, such as distinct message-input actions.
   */
  bindingIds?: readonly string[];
}

interface ShortcutDiscoveryContextValue {
  visible: boolean;
  showCenteredFallback: boolean;
  entries: ReturnType<typeof buildShortcutDiscoveryEntries>;
  anchoredBindingIds: ReadonlySet<string>;
  registerAnchor: (id: string, anchor: ShortcutDiscoveryAnchor) => () => void;
}

interface ShortcutDiscoveryHintPosition {
  left: number;
  top: number;
}

const ShortcutDiscoveryContext = createContext<ShortcutDiscoveryContextValue | null>(null);

export function ShortcutDiscoveryProvider({ children }: { children: ReactNode }) {
  const visible = useShowShortcutDiscovery();
  const showCenteredFallback = useShowCenteredShortcutDiscovery();
  const modifiers = useKeyboardShortcutsStore((state) => state.shortcutDiscoveryModifiers);
  const commandCenterOpen = useKeyboardShortcutsStore((state) => state.commandCenterOpen);
  const { overrides } = useKeyboardShortcutOverrides();
  const isMac = getShortcutOs() === "mac";
  const isDesktop = getIsElectronRuntime();
  const [anchorsById, setAnchorsById] = useState<Map<string, ShortcutDiscoveryAnchor>>(
    () => new Map(),
  );

  const entries = useMemo(() => {
    if (!isWeb || !visible) {
      return [];
    }

    const focusScope = resolveKeyboardFocusScope({
      target: document.activeElement,
      commandCenterOpen,
    });
    return buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings(overrides),
      context: { isMac, isDesktop, focusScope, commandCenterOpen },
      heldModifiers: modifiers,
    });
  }, [commandCenterOpen, isDesktop, isMac, modifiers, overrides, visible]);

  const registerAnchor = useCallback((id: string, anchor: ShortcutDiscoveryAnchor) => {
    setAnchorsById((current) => {
      const existing = current.get(id);
      if (
        existing?.action === anchor.action &&
        existing.bindingIds?.join("|") === anchor.bindingIds?.join("|")
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(id, anchor);
      return next;
    });
    return () => {
      setAnchorsById((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const anchoredBindingIds = useMemo(
    () =>
      new Set(
        entries
          .filter((entry) =>
            Array.from(anchorsById.values()).some(
              (anchor) =>
                anchor.action === entry.action &&
                (anchor.bindingIds === undefined || anchor.bindingIds.includes(entry.bindingId)),
            ),
          )
          .map((entry) => entry.bindingId),
      ),
    [anchorsById, entries],
  );
  const value = useMemo(
    () => ({ visible, showCenteredFallback, entries, anchoredBindingIds, registerAnchor }),
    [anchoredBindingIds, entries, registerAnchor, showCenteredFallback, visible],
  );

  return (
    <ShortcutDiscoveryContext.Provider value={value}>{children}</ShortcutDiscoveryContext.Provider>
  );
}

/**
 * Renders the remaining keys on a visible trigger and removes that action from
 * the centered fallback. The trigger owns positioning so hints can be overlaid
 * without a global measurement pass.
 */
export function ShortcutDiscoveryHint({
  action,
  bindingIds,
  digit,
  enabled = true,
  style,
  testID,
}: {
  action: ShortcutDiscoveryAction;
  /** Limits a shared action to the binding(s) this trigger performs. */
  bindingIds?: readonly string[];
  /** Replaces the registry's `1-9` placeholder for a concrete indexed trigger. */
  digit?: number;
  /** Hidden triggers leave their action in the centered fallback. */
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const context = useContext(ShortcutDiscoveryContext);
  const id = useId();
  const anchorRef = useRef<View>(null);
  const [position, setPosition] = useState<ShortcutDiscoveryHintPosition | null>(null);
  const registerAnchor = context?.registerAnchor;
  // Call sites commonly pass a literal list. Canonicalize it so that does not
  // cause an effect cleanup/re-register loop on every render.
  const bindingIdKey = bindingIds?.join("|");
  const matchingBindingIds = useMemo(
    () => (bindingIdKey === undefined ? undefined : bindingIdKey.split("|")),
    [bindingIdKey],
  );
  const anchor = useMemo(
    () => ({ action, bindingIds: matchingBindingIds }),
    [action, matchingBindingIds],
  );

  useEffect(() => {
    if (!enabled || !context?.visible) {
      return;
    }
    return registerAnchor?.(id, anchor);
  }, [anchor, context?.visible, enabled, id, registerAnchor]);

  const entry = context?.entries.find(
    (candidate) =>
      candidate.action === action &&
      (matchingBindingIds === undefined || matchingBindingIds.includes(candidate.bindingId)),
  );
  const isVisible = enabled && context?.visible === true && entry !== undefined;
  const keys = (entry?.remainingKeys ?? []).map((key) =>
    key === "1-9" && digit !== undefined ? String(digit) : key,
  );

  const updatePosition = useCallback(() => {
    const anchorElement = anchorRef.current;
    if (!isWeb || !anchorElement) return;
    anchorElement.measureInWindow((x, y, width, height) => {
      void measureFloatingPanelPortalHost(DEFAULT_FLOATING_PANEL_PORTAL_HOST).then((host) => {
        setPosition(
          host
            ? {
                left: clampShortcutDiscoveryCoordinate(x - host.x, width, host.width),
                top: clampShortcutDiscoveryCoordinate(y - host.y, height, host.height),
              }
            : null,
        );
        return undefined;
      });
    });
  }, []);

  useEffect(() => {
    if (!isWeb || !isVisible) {
      setPosition(null);
      return;
    }
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    // Capture nested ScrollView scrolls too, because a clipped host is often a
    // scroll container whose content moves without triggering a layout event.
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isVisible, updatePosition]);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      {/* This local copy gives us the exact requested position without escaping
          through the trigger's layout. It is transparent so parent overflow
          rules cannot clip the visible portal copy below. */}
      <View
        ref={anchorRef}
        collapsable={false}
        pointerEvents="none"
        style={[style, styles.measurementAnchor]}
        testID={testID ?? `shortcut-discovery-${action}`}
        onLayout={updatePosition}
      >
        <ShortcutDiscoveryBadge keys={keys} />
      </View>
      {position ? (
        <Portal hostName={DEFAULT_FLOATING_PANEL_PORTAL_HOST}>
          <View pointerEvents="none" style={[styles.anchoredHint, position]}>
            <ShortcutDiscoveryBadge keys={keys} />
          </View>
        </Portal>
      ) : null}
    </>
  );
}

/**
 * The first contextual-discovery surface. Until commands opt into an anchored
 * trigger, their focus-valid shortcut is listed here in the middle of the
 * current view. Workspace index navigation remains anchored to its rows.
 */
export function ShortcutDiscoveryOverlay() {
  const { t } = useTranslation();
  const context = useContext(ShortcutDiscoveryContext);
  const entries = useMemo(
    () =>
      (context?.entries ?? []).filter(
        (entry) =>
          entry.action !== "workspace.navigate.index" &&
          !context?.anchoredBindingIds.has(entry.bindingId),
      ),
    [context],
  );

  if (!isWeb || !context?.showCenteredFallback || entries.length === 0) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.overlay} testID="shortcut-discovery-overlay">
      <View accessibilityLiveRegion="polite" pointerEvents="auto" style={styles.panel}>
        <Text style={styles.title}>{t("settings.shortcuts.dialogTitle")}</Text>
        <ScrollView
          contentContainerStyle={styles.rows}
          showsVerticalScrollIndicator
          style={styles.rowsScroll}
        >
          {entries.map((entry) => (
            <View key={entry.bindingId} style={styles.row}>
              <Text numberOfLines={1} style={styles.label}>
                {t(entry.labelKey)}
              </Text>
              <ShortcutDiscoveryBadge keys={entry.remainingKeys} style={styles.shortcut} />
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  measurementAnchor: {
    opacity: 0,
  },
  anchoredHint: {
    position: "absolute",
    zIndex: 1001,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  panel: {
    width: "78%",
    maxWidth: 560,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    maxHeight: "78%",
    ...theme.shadow.lg,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  rows: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  rowsScroll: {
    flexShrink: 1,
  },
  row: {
    width: "50%",
    minHeight: 30,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  shortcut: {
    flexShrink: 0,
  },
}));
