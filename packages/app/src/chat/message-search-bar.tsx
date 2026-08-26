import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowDown, ArrowUp, X } from "@/components/icons/material-icons";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { StreamItem } from "@/types/stream";
import {
  findChatMessageMatches,
  type ChatMessageSearchOptions,
  type ChatMessageSearchResult,
  type ChatMessageSearchState,
} from "./message-search";

const ThemedFindInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedX = withUnistyles(X);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface ChatMessageSearchHandle {
  open(): void;
}

const INITIAL_OPTIONS: ChatMessageSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

export const ChatMessageSearchBar = forwardRef<
  ChatMessageSearchHandle,
  {
    items: readonly StreamItem[];
    onNavigateToResult: (result: ChatMessageSearchResult) => void;
    onSearchStateChange: (state: ChatMessageSearchState | null) => void;
    onClose: () => void;
  }
>(function ChatMessageSearchBar({ items, onNavigateToResult, onSearchStateChange, onClose }, ref) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(INITIAL_OPTIONS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const inputRef = useRef<TextInput | null>(null);
  const queryLengthRef = useRef(query.length);
  const lastNavigatedResultRef = useRef<string | null>(null);
  queryLengthRef.current = query.length;
  const results = useMemo(
    () => findChatMessageMatches(items, query, options),
    [items, options, query],
  );
  const activeResult = results[activeIndex] ?? null;

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusSignal((value) => value + 1);
  }, []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);
  useImperativeHandle(ref, () => ({ open: openSearch }), [openSearch]);

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (isWeb) {
      const handle = input as TextInput & { getNativeRef?: () => unknown };
      const native = handle.getNativeRef?.() ?? input;
      if (native instanceof HTMLInputElement) native.select();
      return;
    }
    input.setSelection(0, queryLengthRef.current);
  }, [focusSignal, open]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [activeIndex, results.length]);

  // Find is a direct-manipulation interaction. Publish its state before the
  // browser paints the input update so the transcript's marks keep pace with
  // every keystroke instead of visibly catching up a frame later.
  useLayoutEffect(() => {
    onSearchStateChange(open && query.length > 0 ? { query, options, activeResult } : null);
  }, [activeResult, onSearchStateChange, open, options, query]);

  useEffect(() => {
    if (!activeResult) {
      lastNavigatedResultRef.current = null;
      return;
    }
    const resultKey = `${activeResult.itemId}:${activeResult.start}:${activeResult.end}`;
    if (lastNavigatedResultRef.current === resultKey) return;
    lastNavigatedResultRef.current = resultKey;
    onNavigateToResult(activeResult);
  }, [activeResult, onNavigateToResult]);

  const resetToFirstResult = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setActiveIndex(0);
  }, []);
  const toggleOption = useCallback((key: keyof ChatMessageSearchOptions) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
    setActiveIndex(0);
  }, []);
  const move = useCallback(
    (delta: 1 | -1) => {
      if (results.length === 0) return;
      setActiveIndex((current) => (current + delta + results.length) % results.length);
    },
    [results.length],
  );
  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      if (event.nativeEvent.key === "Escape") closeSearch();
    },
    [closeSearch],
  );
  const handleSubmit = useCallback(() => move(1), [move]);
  const handlePrevious = useCallback(() => move(-1), [move]);
  const handleNext = useCallback(() => move(1), [move]);
  const handleToggleCase = useCallback(() => toggleOption("caseSensitive"), [toggleOption]);
  const handleToggleWord = useCallback(() => toggleOption("wholeWord"), [toggleOption]);
  const handleToggleRegexp = useCallback(() => toggleOption("regexp"), [toggleOption]);

  if (!open) return null;
  let matchCount = "";
  if (query.length > 0) {
    matchCount = results.length === 0 ? "No matches" : `${activeIndex + 1}/${results.length}`;
  }

  return (
    <View style={styles.bar} testID="chat-find-strip">
      <ThemedFindInput
        ref={inputRef}
        style={styles.input}
        value={query}
        onChangeText={resetToFirstResult}
        placeholder="Find in chat"
        accessibilityLabel="Find in chat"
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        onSubmitEditing={handleSubmit}
        onKeyPress={handleKeyPress}
        testID="chat-find-input"
      />
      {matchCount ? <Text style={styles.matchCount}>{matchCount}</Text> : null}
      <SearchButton label="Previous result" onPress={handlePrevious} testID="chat-find-previous">
        <ThemedArrowUp size="sm" uniProps={mutedIconColorMapping} />
      </SearchButton>
      <SearchButton label="Next result" onPress={handleNext} testID="chat-find-next">
        <ThemedArrowDown size="sm" uniProps={mutedIconColorMapping} />
      </SearchButton>
      <FindToggle
        label="Cc"
        active={options.caseSensitive}
        accessibilityLabel="Match case"
        onPress={handleToggleCase}
        testID="chat-find-case"
      />
      <FindToggle
        label="W"
        active={options.wholeWord}
        accessibilityLabel="Match whole word"
        onPress={handleToggleWord}
        testID="chat-find-word"
      />
      <FindToggle
        label=".*"
        active={options.regexp}
        accessibilityLabel="Use regular expression"
        onPress={handleToggleRegexp}
        testID="chat-find-regex"
      />
      <SearchButton label="Close find" onPress={closeSearch} testID="chat-find-close">
        <ThemedX size="sm" uniProps={mutedIconColorMapping} />
      </SearchButton>
    </View>
  );
});

function SearchButton({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  children: React.ReactNode;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.iconButton,
      (hovered || pressed) && styles.iconButtonActive,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function FindToggle({
  label,
  active,
  accessibilityLabel,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
}) {
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.toggle,
      active && styles.toggleActive,
      (hovered || pressed) && !active && styles.iconButtonActive,
    ],
    [active],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 80,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    outlineWidth: 0,
  },
  matchCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: 6,
  },
  iconButtonActive: { backgroundColor: theme.colors.surfaceHover },
  toggle: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toggleActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  toggleLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  toggleLabelActive: { color: theme.colors.foreground },
}));
