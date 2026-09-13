import React, { useCallback, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import { Pressable, View, type Text, type LayoutChangeEvent } from "react-native";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { mergeRefs } from "@/utils/merge-refs";
import { useSettingsTarget } from "./target";

interface TargetIds {
  settingIds: readonly string[];
}

/** The existing Pressable retains its tab order, geometry and action semantics. */
export function SettingsButton({
  settingIds,
  ref,
  onLayout,
  ...props
}: ComponentProps<typeof Button> & TargetIds) {
  const { node, handleLayout } = useSettingsTarget(settingIds, onLayout);
  const mergedRef = useMemo(() => mergeRefs(node as RefObject<View | null>, ref), [node, ref]);
  return <Button {...props} ref={mergedRef} onLayout={handleLayout} />;
}

/** The existing input handle owns resets/caret/IME; search reads its current native ref. */
export function SettingsEditingTextInput({
  settingIds,
  ref,
  onLayout,
  ...props
}: ComponentProps<typeof EditingTextInput> & TargetIds) {
  const input = useRef<EditingTextInputHandle | null>(null);
  const { node, handleLayout } = useSettingsTarget(settingIds, onLayout);
  const readNativeRef = useCallback(() => {
    // getNativeRef is the input owner's explicit cross-platform escape hatch.
    node.current = (input.current?.getNativeRef() ?? null) as View | Text | null;
  }, [node]);
  const setInput = useCallback(
    (handle: EditingTextInputHandle | null) => {
      input.current = handle;
      readNativeRef();
    },
    [readNativeRef],
  );
  const mergedRef = useMemo(() => mergeRefs(setInput, ref), [setInput, ref]);
  const handleInputLayout = useCallback(
    (event: LayoutChangeEvent) => {
      readNativeRef();
      handleLayout(event);
    },
    [readNativeRef, handleLayout],
  );
  return <EditingTextInput {...props} ref={mergedRef} onLayout={handleInputLayout} />;
}

/** An existing icon/row Pressable keeps its role, keyboard behavior and exact geometry. */
export function SettingsPressable({
  settingIds,
  ref,
  onLayout,
  ...props
}: ComponentProps<typeof Pressable> & TargetIds) {
  const { node, handleLayout } = useSettingsTarget(settingIds, onLayout);
  const mergedRef = useMemo(() => mergeRefs(node as RefObject<View | null>, ref), [node, ref]);
  return <Pressable {...props} ref={mergedRef} onLayout={handleLayout} />;
}
