import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, X, Check, Square } from "@/components/icons/material-icons";
import { buildPageFindScript, type PageFindRequest, type PageFindResult } from "./page-find";

export interface FindableGuest extends HTMLElement {
  executeJavaScript?: (code: string) => Promise<unknown>;
}
const DEFAULT_OPTIONS = {
  matchCase: false,
  matchDiacritics: false,
  wholeWords: false,
  highlightAll: true,
};

export function BrowserFindBar({
  guestRef,
  focusRequest,
  onClose,
}: {
  guestRef: RefObject<FindableGuest | null>;
  focusRequest: number;
  onClose: () => void;
}) {
  const input = useRef<EditingTextInputHandle>(null);
  const bar = useRef<View>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<PageFindResult>({ current: 0, total: 0, limited: false });
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const run = useCallback(
    (direction: PageFindRequest["direction"]) => {
      const id = direction === 0 ? ++generation.current : generation.current;
      const guest = guestRef.current;
      const execute = async () => {
        await queue.current;
        if (id !== generation.current || !guest?.executeJavaScript) return;
        try {
          const next = await guest.executeJavaScript(
            buildPageFindScript({ query, ...options, direction }),
          );
          if (id === generation.current) {
            setResult(next as PageFindResult);
            setError(false);
          }
        } catch {
          if (id === generation.current) setError(true);
        }
      };
      queue.current = execute();
    },
    [guestRef, query, options],
  );
  useEffect(() => {
    const timer = setTimeout(() => run(0), 150);
    return () => clearTimeout(timer);
  }, [run]);
  useEffect(() => {
    input.current?.focus();
    const node = input.current?.getNativeRef() as HTMLInputElement | null;
    node?.select?.();
  }, [focusRequest]);
  useEffect(() => {
    const guest = guestRef.current;
    const ready = () => run(0);
    guest?.addEventListener("dom-ready", ready);
    return () => guest?.removeEventListener("dom-ready", ready);
  }, [guestRef, run]);
  useEffect(
    () => () => {
      ++generation.current;
      const guest = guestRef.current;
      void queue.current
        .then(() =>
          guest?.executeJavaScript?.(
            buildPageFindScript({ query: "", ...DEFAULT_OPTIONS, direction: 0 }),
          ),
        )
        .catch(() => {});
    },
    [guestRef],
  );
  const previous = useCallback(() => run(-1), [run]);
  const next = useCallback(() => run(1), [run]);
  useEffect(() => {
    const node = bar.current as unknown as HTMLElement | null;
    if (!node) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "Enter" && event.target === input.current?.getNativeRef()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        run(event.shiftKey ? -1 : 1);
      }
    };
    node.addEventListener("keydown", keyDown, true);
    return () => node.removeEventListener("keydown", keyDown, true);
  }, [run, onClose]);
  let status = query ? `${result.current} of ${result.total}${result.limited ? "+" : ""}` : "";
  if (error) status = "Search unavailable";
  return (
    <View ref={bar} style={styles.bar} testID="browser-find-bar">
      <EditingTextInput
        ref={input}
        accessibilityLabel="Find in page"
        placeholder="Find in page"
        initialValue=""
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.navigation}>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={ChevronUp}
          accessibilityLabel="Previous match"
          disabled={!query || !result.total}
          onPress={previous}
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={ChevronDown}
          accessibilityLabel="Next match"
          disabled={!query || !result.total}
          onPress={next}
        />
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {status}
        </Text>
      </View>
      <View style={styles.options}>
        <FindOption
          label="Highlight All"
          name="highlightAll"
          options={options}
          onChange={setOptions}
        />
        <FindOption label="Match Case" name="matchCase" options={options} onChange={setOptions} />
        <FindOption
          label="Match Diacritics"
          name="matchDiacritics"
          options={options}
          onChange={setOptions}
        />
        <FindOption label="Whole Words" name="wholeWords" options={options} onChange={setOptions} />
      </View>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={X}
        accessibilityLabel="Close find in page"
        onPress={onClose}
      />
    </View>
  );
}

function FindOption({
  name,
  label,
  options,
  onChange,
}: {
  name: keyof typeof DEFAULT_OPTIONS;
  label: string;
  options: typeof DEFAULT_OPTIONS;
  onChange: (options: typeof DEFAULT_OPTIONS) => void;
}) {
  const toggle = useCallback(
    () => onChange({ ...options, [name]: !options[name] }),
    [name, options, onChange],
  );
  const accessibilityState = useMemo(() => ({ checked: options[name] }), [name, options]);
  return (
    <Button
      variant="ghost"
      size="xs"
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      leftIcon={options[name] ? Check : Square}
      onPress={toggle}
    >
      {label}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.statusInfo,
    backgroundColor: theme.colors.statusInfoSurface,
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 180,
    minWidth: 100,
    height: 28,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    fontSize: theme.fontSize.sm,
  },
  navigation: { flexDirection: "row", alignItems: "center", gap: 2 },
  options: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", flexGrow: 1 },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs, minWidth: 50 },
}));
