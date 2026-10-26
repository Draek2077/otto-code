import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BrowserHistoryEntry } from "@getpaseo/plugin/otto/browser-history";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { FloatingSurface, FloatingScrollView } from "@/components/ui/floating";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Button } from "@/components/ui/button";
import { getOverlayRoot, useOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";
import { isWeb } from "@/constants/platform";
import { BrowserHistoryModel } from "./history-model";

function inputElement(ref: RefObject<EditingTextInputHandle | null>) {
  if (!isWeb) return null;
  const node = ref.current?.getNativeRef();
  return node instanceof HTMLInputElement ? node : null;
}
function keepInputFocus(event: MouseEvent) {
  event.preventDefault();
}
export function BrowserHistorySuggestions({
  model,
  inputRef,
  query,
  active,
  onNavigate,
}: {
  model: BrowserHistoryModel;
  inputRef: RefObject<EditingTextInputHandle | null>;
  query: string;
  active: boolean;
  onNavigate(url: string): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const id = useId();
  const layer = useOverlayLayer("floating");
  const visible = active && (state.entries.length > 0 || Boolean(state.searchError));
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const choose = useCallback(
    (url: string) => {
      model.dismiss();
      onNavigate(url);
    },
    [model, onNavigate],
  );
  const retry = useCallback(() => model.search(query), [model, query]);
  const overlayKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      model.dismiss();
      return true;
    },
    [model],
  );
  const setScope = useWebOverlayRegistration({
    active: visible,
    layer,
    onKeyDown: overlayKey,
    manageFocus: false,
  });
  useEffect(() => {
    model.search(query);
  }, [model, query]);
  useEffect(() => {
    if (!isWeb || !active) {
      model.focus(false);
      return;
    }
    const node = inputElement(inputRef);
    if (!node) return;
    const focus = () => model.focus(true),
      blur = () => model.focus(false);
    node.addEventListener("focus", focus);
    node.addEventListener("blur", blur);
    node.addEventListener("input", focus);
    if (document.activeElement === node) focus();
    return () => {
      node.removeEventListener("focus", focus);
      node.removeEventListener("blur", blur);
      node.removeEventListener("input", focus);
      model.focus(false);
    };
  }, [active, model, inputRef]);
  useEffect(() => {
    if (!isWeb) return;
    const node = inputElement(inputRef);
    if (!node) return;
    node.setAttribute("role", "combobox");
    node.setAttribute("aria-autocomplete", "list");
    node.setAttribute("aria-expanded", String(visible));
    node.setAttribute("aria-controls", id);
    if (visible && state.selected >= 0)
      node.setAttribute("aria-activedescendant", `${id}-${state.selected}`);
    else node.removeAttribute("aria-activedescendant");
    const key = (event: KeyboardEvent) => {
      if (!visible || event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        model.move(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        model.dismiss();
      } else if (event.key === "Enter" && model.selected()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(model.selected()!);
      }
    };
    node.addEventListener("keydown", key, true);
    return () => {
      node.removeEventListener("keydown", key, true);
      for (const name of [
        "role",
        "aria-autocomplete",
        "aria-expanded",
        "aria-controls",
        "aria-activedescendant",
      ])
        node.removeAttribute(name);
    };
  }, [inputRef, model, choose, visible, id, state.selected]);
  useEffect(() => {
    if (!isWeb || !visible) return;
    const node = inputElement(inputRef);
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setFrame({
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
        maxHeight: Math.max(40, Math.min(280, window.innerHeight - rect.bottom - 12)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, inputRef]);
  useEffect(() => {
    if (isWeb && visible && state.selected >= 0)
      document.getElementById(`${id}-${state.selected}`)?.scrollIntoView({ block: "nearest" });
  }, [id, visible, state.selected]);
  const frameStyle = useMemo(() => ({ ...frame, zIndex: layer }), [frame, layer]);
  if (!isWeb || !visible || !frame.width) return null;
  return createPortal(
    <FloatingSurface frameStyle={frameStyle} style={styles.popup} ref={setScope}>
      <FloatingScrollView keyboardShouldPersistTaps="always">
        <div id={id} role="listbox" aria-label="Browsing history" onMouseDown={keepInputFocus}>
          {state.entries.map((entry, index) => (
            <HistoryRow
              key={entry.url}
              entry={entry}
              id={`${id}-${index}`}
              selected={index === state.selected}
              choose={choose}
            />
          ))}
          {state.searchError ? (
            <>
              <Text style={styles.error}>{state.searchError}</Text>
              <Button size="xs" variant="outline" onPress={retry}>
                Retry history search
              </Button>
            </>
          ) : null}
        </div>
      </FloatingScrollView>
    </FloatingSurface>,
    getOverlayRoot(),
  );
}
function HistoryRow({
  entry,
  id,
  selected,
  choose,
}: {
  entry: BrowserHistoryEntry;
  id: string;
  selected: boolean;
  choose(url: string): void;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []),
    leave = useCallback(() => setHovered(false), []);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.row,
      (selected || hovered || pressed) && styles.highlight,
    ],
    [selected, hovered],
  );
  const select = useCallback(() => choose(entry.url), [choose, entry.url]);
  return (
    <div id={id} role="option" aria-selected={selected}>
      <View onPointerEnter={enter} onPointerLeave={leave}>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={entry.title || entry.url}
          onPress={select}
          style={rowStyle}
        >
          <Text numberOfLines={1} style={styles.title}>
            {entry.title || entry.url}
          </Text>
          {entry.title ? (
            <Text numberOfLines={1} style={styles.url}>
              {entry.url}
            </Text>
          ) : null}
        </PressHighlight>
      </View>
    </div>
  );
}
const styles = StyleSheet.create((theme) => ({
  popup: {
    position: "absolute",
    pointerEvents: "auto",
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    paddingVertical: theme.spacing[1],
  },
  error: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
  row: { paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], minWidth: 0 },
  highlight: { backgroundColor: theme.colors.interactionHighlight },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  url: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
