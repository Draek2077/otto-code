import { useMemo } from "react";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { buildEffectiveBindings } from "@/keyboard/keyboard-shortcuts";
import { buildEditorKeyBindings } from "./bindings";
import { getShortcutOs } from "@/utils/shortcut-platform";
export function useEditorKeyBindings() {
  const { overrides } = useKeyboardShortcutOverrides();
  return useMemo(
    () =>
      buildEditorKeyBindings(buildEffectiveBindings(overrides), {
        isMac: getShortcutOs() === "mac",
      }),
    [overrides],
  );
}
