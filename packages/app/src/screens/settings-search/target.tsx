import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Text,
  View,
  type ScrollView,
  type ViewProps,
  type TextProps,
} from "react-native";
import { isWeb } from "@/constants/platform";
import { useScrollViewport } from "@/components/ui/scroll-viewport-context";
import { SettingsTargetRegistry } from "./target-registry";

interface SettingsSearchContextValue {
  scrollable: boolean;
  settingId: string | null;
  registry: SettingsTargetRegistry;
  content: RefObject<View | null>;
  scroll: RefObject<ScrollView | null>;
}
const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

function useSettingsSearchOwner(
  settingId: string | null,
  content: RefObject<View | null>,
  scroll: RefObject<ScrollView | null>,
  scrollable: boolean,
): SettingsSearchContextValue {
  const registry = useMemo(() => new SettingsTargetRegistry(), []);
  const value = useMemo(
    () => ({ registry, content, scroll, settingId, scrollable }),
    [registry, content, scroll, settingId, scrollable],
  );
  useLayoutEffect(() => {
    registry.request(settingId);
    return () => registry.request(null);
  }, [registry, settingId]);
  return value;
}

/** A sheet host outside Settings owns the request without adding a body or scroll container. */
export function SettingsSearchProvider({
  settingId,
  children,
}: {
  settingId: string | null;
  children: ReactNode;
}) {
  const content = useRef<View | null>(null);
  const scroll = useRef<ScrollView | null>(null);
  const value = useSettingsSearchOwner(settingId, content, scroll, false);
  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

/** The same owner serves compact and desktop Settings; no document-global lookup. */
export function SettingsSearchContent({
  settingId,
  scroll,
  children,
  onLayout,
  ...props
}: ViewProps & {
  settingId: string | null;
  scroll: RefObject<ScrollView | null>;
  children: ReactNode;
}) {
  const content = useRef<View | null>(null);
  const value = useSettingsSearchOwner(settingId, content, scroll, true);
  const handleLayout = useCallback<NonNullable<ViewProps["onLayout"]>>(
    (event) => {
      onLayout?.(event);
      value.registry.layout();
    },
    [onLayout, value.registry],
  );
  return (
    <SettingsSearchContext.Provider value={value}>
      <View {...props} ref={content} onLayout={handleLayout}>
        {children}
      </View>
    </SettingsSearchContext.Provider>
  );
}

/** Replace the row's existing View with this component; geometry and ownership stay local. */
export function useSettingsTarget(ids: readonly string[], onLayout: ViewProps["onLayout"]) {
  const context = useContext(SettingsSearchContext);
  const node = useRef<View | Text | null>(null);
  const viewport = useScrollViewport();
  const focus = useCallback(
    (isCurrent: () => boolean, requestedId: string): boolean | Promise<boolean> => {
      if (!node.current || !context || !isCurrent()) return false;
      if (isWeb) {
        const element = node.current as unknown as HTMLElement;
        if (!element.isConnected || element.getClientRects().length === 0) return false;
        element.dataset.settingsSearchTarget = requestedId;
        element.id = requestedId;
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        element.focus({ preventScroll: true });
        return true;
      }
      if (!viewport && !context.scrollable) {
        const target = node.current;
        return new Promise((resolve) => {
          target.measureInWindow((_x, _y, width, height) => {
            if (node.current !== target || !isCurrent() || width <= 0 || height <= 0)
              return resolve(false);
            const handle = findNodeHandle(target);
            if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
            resolve(true);
          });
        });
      }
      const content = (viewport ?? context).content.current;
      const scroll = (viewport ?? context).scroll.current;
      if (!content || !scroll) return false;
      const target = node.current;
      return new Promise((resolve) => {
        target.measureLayout(
          content,
          (_x, y, width, height) => {
            if (node.current !== target || !isCurrent() || width <= 0 || height <= 0)
              return resolve(false);
            scroll.scrollTo({ y: Math.max(0, y - 24), animated: true });
            const handle = findNodeHandle(target);
            if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
            resolve(true);
          },
          () => resolve(false),
        );
      });
    },
    [context, viewport],
  );
  useLayoutEffect(() => {
    const cleanup = ids.map((id) =>
      context?.registry.register(id, { focus: (isCurrent) => focus(isCurrent, id) }),
    );
    return () => cleanup.forEach((unregister) => unregister?.());
  }, [context, ids, focus]);
  const handleLayout = useCallback<NonNullable<ViewProps["onLayout"]>>(
    (event) => {
      onLayout?.(event);
      context?.registry.layout();
    },
    [context, onLayout],
  );
  return { node, handleLayout };
}

interface SettingsTargetIds {
  settingId: string | readonly string[];
}
function useTargetIds(id: string | readonly string[]) {
  return useMemo(() => (typeof id === "string" ? [id] : id), [id]);
}

/** Geometry stays with the existing row. Most rows register their label Text. */
export function SettingsTarget({ settingId, onLayout, ...props }: ViewProps & SettingsTargetIds) {
  const ids = useTargetIds(settingId);
  const { node, handleLayout } = useSettingsTarget(ids, onLayout);
  const webProps =
    isWeb && ids.length > 0
      ? { tabIndex: -1 as const, dataSet: { settingsSearchTarget: ids.join(" ") } }
      : {};
  return (
    <View
      {...props}
      {...webProps}
      ref={node as RefObject<View | null>}
      collapsable={false}
      nativeID={ids[0] ?? props.nativeID}
      onLayout={handleLayout}
    />
  );
}

/** A label is naturally accessible on native, without grouping its interactive siblings. */
export function SettingsTargetText({
  settingId,
  onLayout,
  ...props
}: TextProps & SettingsTargetIds) {
  const ids = useTargetIds(settingId);
  const { node, handleLayout } = useSettingsTarget(ids, onLayout);
  const webProps =
    isWeb && ids.length > 0
      ? { tabIndex: -1 as const, dataSet: { settingsSearchTarget: ids.join(" ") } }
      : {};
  return (
    <Text
      {...props}
      {...webProps}
      ref={node as RefObject<Text | null>}
      nativeID={ids[0] ?? props.nativeID}
      onLayout={handleLayout}
    />
  );
}

/** Opening a nested editor is explicit. Actions that save or mutate data are never revealers. */
export function useRevealSettingsTarget(ids: readonly string[], reveal: () => void): void {
  const context = useContext(SettingsSearchContext);
  useLayoutEffect(() => context?.registry.registerReveal(ids, reveal), [context, ids, reveal]);
}

/** A Settings-owned nested portal must carry its existing search request into the editor. */
export function useSettingsSearchContextBridge() {
  const context = useContext(SettingsSearchContext);
  return useCallback(
    (children: ReactNode) => (
      <SettingsSearchContext.Provider value={context}>{children}</SettingsSearchContext.Provider>
    ),
    [context],
  );
}

const TargetIdsContext = createContext<readonly string[]>([]);
/** Assigns identity at a reusable row callsite without adding a layout wrapper. */
export function SettingsTargetScope({
  settingIds,
  children,
}: {
  settingIds: readonly string[];
  children: ReactNode;
}) {
  return <TargetIdsContext.Provider value={settingIds}>{children}</TargetIdsContext.Provider>;
}
export function SettingsTargetLabel(props: TextProps) {
  const ids = useContext(TargetIdsContext);
  return <SettingsTargetText {...props} settingId={ids} />;
}

export function useSettingsSearchRequest(): string | null {
  return useContext(SettingsSearchContext)?.settingId ?? null;
}
