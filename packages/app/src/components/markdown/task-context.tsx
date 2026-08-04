import React, { createContext, useCallback, useContext, useMemo } from "react";
import { Pressable, Text, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";

/**
 * Whether a rendered task list can be ticked, and what happens when it is.
 *
 * Read-only is the default and the common case: a task list inside an
 * assistant message is a description of work, not a control, and there is
 * nothing to write a tick back to. A surface that *does* own the document -
 * the markdown preview beside the editor - supplies a handler, and the same
 * checkbox becomes real.
 */

export interface MarkdownTaskToggleInput {
  /** 1-based source line of the list item. */
  line: number;
  /** The state the user is asking for, not the state it was in. */
  checked: boolean;
}

export type MarkdownTaskToggle = (input: MarkdownTaskToggleInput) => void;

const MarkdownTaskContext = createContext<MarkdownTaskToggle | null>(null);

export function MarkdownTaskProvider({
  onToggle,
  children,
}: {
  onToggle: MarkdownTaskToggle | null;
  children: React.ReactNode;
}) {
  return <MarkdownTaskContext.Provider value={onToggle}>{children}</MarkdownTaskContext.Provider>;
}

export function useMarkdownTaskToggle(): MarkdownTaskToggle | null {
  return useContext(MarkdownTaskContext);
}

const UNCHECKED_GLYPH = "☐";
const CHECKED_GLYPH = "☑";

/**
 * The box itself.
 *
 * Deliberately the same glyphs the read-only rendering has always used rather
 * than an icon component: the box sits inline in a text row whose metrics come
 * from the markdown styles, and a glyph inherits those for free on every
 * platform. What changes when the list is writable is that the glyph gains a
 * press target, not that it changes shape.
 */
export function MarkdownTaskCheckbox({
  checked,
  line,
  style,
}: {
  checked: boolean;
  /** Null when the token carried no source map, which makes this read-only. */
  line: number | null;
  style: TextStyle;
}) {
  const { t } = useTranslation();
  const onToggle = useMarkdownTaskToggle();
  const glyph = checked ? CHECKED_GLYPH : UNCHECKED_GLYPH;
  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  const handlePress = useCallback(() => {
    if (onToggle !== null && line !== null) {
      onToggle({ line, checked: !checked });
    }
  }, [checked, line, onToggle]);

  if (onToggle === null || line === null) {
    return <Text style={style}>{glyph}</Text>;
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={t(
        checked ? "editor.taskList.markIncomplete" : "editor.taskList.markComplete",
      )}
      // The glyph is a few points wide, which is under every platform's minimum
      // touch target, and this is the one control in a rendered document that
      // has to be hittable with a thumb.
      hitSlop={12}
      onPress={handlePress}
    >
      <Text style={style}>{glyph}</Text>
    </Pressable>
  );
}
