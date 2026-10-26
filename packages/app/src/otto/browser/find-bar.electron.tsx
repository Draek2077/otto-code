import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Text, View } from "react-native";
import { ChevronUp, ChevronDown, X, Check, Square } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { PageFindController, type FindableGuest, type PageFindOptions } from "./find-controller";

interface FindGuest extends FindableGuest {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export function BrowserFindBar({
  guestRef,
  focusRequest,
  onClose,
}: {
  guestRef: RefObject<FindGuest | null>;
  focusRequest: number;
  onClose(): void;
}) {
  const [model] = useState(() => new PageFindController(() => guestRef.current));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const input = useRef<EditingTextInputHandle>(null);
  useEffect(() => model.activate(), [model]);
  useEffect(() => {
    const guest = guestRef.current;
    guest?.addEventListener("dom-ready", model.refresh);
    return () => guest?.removeEventListener("dom-ready", model.refresh);
  }, [model, guestRef]);
  useEffect(() => {
    input.current?.focus();
  }, [focusRequest]);
  const previous = useCallback(() => model.run(-1), [model]);
  const next = useCallback(() => model.run(1), [model]);
  const query = useCallback((text: string) => model.setQuery(text), [model]);
  useEffect(() => {
    if (!isWeb) return;
    const node = input.current?.getNativeRef();
    if (!(node instanceof HTMLElement)) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") onClose();
        else model.run(event.shiftKey ? -1 : 1);
      }
    };
    node.addEventListener("keydown", keyDown, true);
    return () => node.removeEventListener("keydown", keyDown, true);
  }, [model, onClose]);
  const count = state.query
    ? `${state.result.current} of ${state.result.total}${state.result.limited ? "+" : ""}`
    : "";
  return (
    <View style={styles.bar} testID="browser-find-bar">
      <View style={styles.input}>
        <FormTextInput
          ref={input}
          size="sm"
          accessibilityLabel="Find in page"
          placeholder="Find in page"
          initialValue=""
          onChangeText={query}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={2048}
        />
      </View>
      <View style={styles.navigation}>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={ChevronUp}
          accessibilityLabel="Previous match"
          disabled={!state.query || !state.result.total}
          onPress={previous}
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={ChevronDown}
          accessibilityLabel="Next match"
          disabled={!state.query || !state.result.total}
          onPress={next}
        />
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {state.error ? "Search unavailable" : count}
        </Text>
      </View>
      <View style={styles.options}>
        <FindOption
          model={model}
          label="Highlight All"
          name="highlightAll"
          options={state.options}
        />
        <FindOption model={model} label="Match Case" name="matchCase" options={state.options} />
        <FindOption
          model={model}
          label="Match Diacritics"
          name="matchDiacritics"
          options={state.options}
        />
        <FindOption model={model} label="Whole Words" name="wholeWords" options={state.options} />
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
  model,
  name,
  label,
  options,
}: {
  model: PageFindController;
  name: keyof PageFindOptions;
  label: string;
  options: PageFindOptions;
}) {
  const toggle = useCallback(() => model.setOption(name, !options[name]), [model, name, options]);
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
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  input: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 100 },
  navigation: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  options: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", flexGrow: 1 },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, minWidth: 50 },
}));
