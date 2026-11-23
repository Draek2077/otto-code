import { useMemo } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
export function EditorShortcutMenuItem({
  label,
  helpId,
  onSelect,
  disabled,
}: {
  label: string;
  helpId: string;
  onSelect(): void;
  disabled?: boolean;
}) {
  const keys = useShortcutKeys(helpId);
  const hint = useMemo(() => (keys ? <Shortcut chord={keys} /> : null), [keys]);
  return (
    <DropdownMenuItem onSelect={onSelect} disabled={disabled} trailing={hint}>
      {label}
    </DropdownMenuItem>
  );
}
