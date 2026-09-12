import { useCallback, useEffect, useMemo, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BrowserHistoryEntry } from "@otto-code/protocol/messages";
import { FloatingSurface, FloatingScrollView } from "@/components/ui/floating";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { getBrowserHistoryClient } from "../history";

export function BrowserHistorySuggestions({
  serverId,
  workspaceId,
  inputRef,
  query,
  onNavigate,
  active,
}: {
  serverId?: string | null;
  workspaceId: string;
  inputRef: RefObject<unknown>;
  query: string;
  onNavigate: (url: string) => void;
  active: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>([]);
  const [selected, setSelected] = useState(-1);
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const resultsFor = useRef("");
  const visible =
    active && focused && !dismissed && entries.length > 0 && resultsFor.current === query;
  const choose = useCallback(
    (url: string) => {
      setDismissed(true);
      setSelected(-1);
      onNavigate(url);
    },
    [onNavigate],
  );
  useEffect(() => {
    const node = inputRef.current as unknown as HTMLInputElement | null;
    if (!node) return;
    const focus = () => {
      setFocused(true);
      setDismissed(false);
    };
    const blur = () => {
      setFocused(false);
      setSelected(-1);
    };
    const input = () => {
      setDismissed(false);
      setSelected(-1);
    };
    node.addEventListener("focus", focus);
    node.addEventListener("blur", blur);
    node.addEventListener("input", input);
    return () => {
      node.removeEventListener("focus", focus);
      node.removeEventListener("blur", blur);
      node.removeEventListener("input", input);
    };
  }, [inputRef]);
  useEffect(() => {
    setSelected(-1);
    setEntries([]);
    if (!focused || dismissed || !active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const client = getBrowserHistoryClient(serverId);
      if (!client) return;
      void client
        .searchBrowserHistory(workspaceId, query.slice(0, 8192))
        .then((items) => {
          if (!cancelled) {
            resultsFor.current = query;
            setEntries(items);
          }
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setEntries([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [serverId, workspaceId, query, focused, dismissed, active]);
  useEffect(() => {
    const node = inputRef.current as unknown as HTMLInputElement | null;
    if (!node) return;
    node.setAttribute("role", "combobox");
    node.setAttribute("aria-autocomplete", "list");
    node.setAttribute("aria-expanded", String(visible));
    node.setAttribute("aria-controls", id);
    if (visible && selected >= 0) node.setAttribute("aria-activedescendant", `${id}-${selected}`);
    else node.removeAttribute("aria-activedescendant");
    const key = (event: KeyboardEvent) => {
      if (!visible || event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelected((index) => {
          if (event.key === "ArrowDown") return (index + 1) % entries.length;
          return index < 0 ? entries.length - 1 : (index - 1 + entries.length) % entries.length;
        });
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDismissed(true);
      } else if (event.key === "Enter") {
        setDismissed(true);
        if (selected >= 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          choose(entries[selected]!.url);
        }
      }
    };
    node.addEventListener("keydown", key, true);
    return () => node.removeEventListener("keydown", key, true);
  }, [inputRef, visible, selected, entries, choose, id]);
  useEffect(() => {
    if (!visible) return;
    const node = inputRef.current as unknown as HTMLInputElement | null;
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
    if (selected >= 0)
      document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [id, selected]);
  if (!visible || !frame.width) return null;
  return createPortal(
    <FloatingSurface frameStyle={frame} style={styles.popup}>
      <FloatingScrollView keyboardShouldPersistTaps="always">
        <div id={id} role="listbox" aria-label="Browsing history">
          {entries.map((entry, index) => (
            <HistoryRow
              key={entry.url}
              entry={entry}
              id={`${id}-${index}`}
              selected={selected === index}
              onSelect={choose}
            />
          ))}
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
  onSelect,
}: {
  entry: BrowserHistoryEntry;
  id: string;
  selected: boolean;
  onSelect: (url: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const choose = useCallback(() => onSelect(entry.url), [onSelect, entry.url]);
  const preventBlur = useCallback(
    (event: { preventDefault: () => void }) => event.preventDefault(),
    [],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <View onPointerEnter={enter} onPointerLeave={leave} onPointerDown={preventBlur}>
      <Pressable
        nativeID={id}
        role="option"
        accessibilityState={accessibilityState}
        onPress={choose}
        style={[styles.row, selected && styles.selected, hovered && styles.hovered]}
      >
        {entry.title ? (
          <Text numberOfLines={1} style={styles.title}>
            {entry.title}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={styles.url}>
          {entry.url}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  popup: {
    position: "absolute",
    zIndex: OVERLAY_Z.floating,
    pointerEvents: "auto",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  row: { minHeight: 32, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  selected: { backgroundColor: theme.colors.surfaceInteractiveSelected },
  hovered: { backgroundColor: theme.colors.surfaceInteractiveHover },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  url: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
}));
