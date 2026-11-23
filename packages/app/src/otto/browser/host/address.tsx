import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ScrollView,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { PressHighlight } from "@/components/ui/press-highlight";
import { BrowserHistoryModel } from "../history-model";
import { styles } from "./styles";

export function HostBrowserAddress(props: {
  hostId: string;
  workspaceId: string;
  url: string;
  title: string;
  active: boolean;
  navigate(url: string): void;
  model: BrowserHistoryModel | null;
}) {
  return <AddressInput {...props} key={`${props.hostId}/${props.workspaceId}`} />;
}
function AddressInput({
  url,
  title,
  active,
  navigate,
  model,
}: {
  url: string;
  title: string;
  active: boolean;
  navigate(url: string): void;
  model: BrowserHistoryModel | null;
}) {
  const input = useRef<EditingTextInputHandle>(null),
    focused = useRef(false);
  const [query, setQuery] = useState(url);
  useEffect(() => (active ? model?.activate() : undefined), [active, model]);
  useEffect(() => {
    if (active) model?.visit(url, title);
  }, [active, model, title, url]);
  useEffect(() => {
    if (!focused.current) {
      input.current?.replaceText(url);
      setQuery(url);
    }
  }, [url]);
  const focus = useCallback(() => {
    focused.current = true;
    model?.focus(true);
    model?.search(input.current?.getText() ?? url);
  }, [model, url]);
  const blur = useCallback(() => {
    focused.current = false;
    model?.focus(false);
  }, [model]);
  const changed = useCallback(
    (value: string) => {
      setQuery(value);
      model?.search(value);
    },
    [model],
  );
  const choose = useCallback(
    (value: string) => {
      input.current?.replaceText(value);
      model?.dismiss();
      navigate(value);
    },
    [model, navigate],
  );
  const submit = useCallback(
    () => choose(model?.selected() ?? input.current?.getText() ?? query),
    [choose, model, query],
  );
  const key = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "ArrowDown") model?.move(1);
      if (event.nativeEvent.key === "ArrowUp") model?.move(-1);
      if (event.nativeEvent.key === "Escape") model?.dismiss();
    },
    [model],
  );
  return (
    <View style={styles.address}>
      <EditingTextInput
        ref={input}
        initialValue={url}
        onChangeText={changed}
        onFocus={focus}
        onBlur={blur}
        onSubmitEditing={submit}
        onKeyPress={key}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Browser address"
        returnKeyType="go"
        selectTextOnFocus
      />
      {model && active ? <Suggestions model={model} choose={choose} /> : null}
    </View>
  );
}
function Suggestions({ model, choose }: { model: BrowserHistoryModel; choose(url: string): void }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  if (!state.entries.length && !state.searchError) return null;
  return (
    <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="always">
      {state.searchError ? <Text style={styles.text}>{state.searchError}</Text> : null}
      {state.entries.map((entry, index) => (
        <Suggestion
          key={entry.url}
          url={entry.url}
          title={entry.title}
          choose={choose}
          selected={index === state.selected}
        />
      ))}
    </ScrollView>
  );
}
function Suggestion({
  url,
  title,
  choose,
  selected,
}: {
  url: string;
  title: string;
  choose(url: string): void;
  selected: boolean;
}) {
  const select = useCallback(() => choose(url), [choose, url]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <PressHighlight
      onPress={select}
      style={styles.suggestion}
      accessibilityState={accessibilityState}
    >
      <Text style={styles.text} numberOfLines={1}>
        {title || url}
      </Text>
    </PressHighlight>
  );
}
