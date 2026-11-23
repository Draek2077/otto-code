import { useCallback } from "react";
import { Monitor } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useBrowserStore, createFixedBrowserViewport } from "@/desktop/browser/store";
const Icon = withUnistyles(Monitor);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const choices = [
  { label: "Responsive", width: null, height: null },
  { label: "Phone · 390 × 844", width: 390, height: 844 },
  { label: "Tablet · 768 × 1024", width: 768, height: 1024 },
  { label: "Desktop · 1280 × 720", width: 1280, height: 720 },
];
export function HostBrowserViewport({ browserId }: { browserId: string }) {
  return (
    <DropdownMenu>
      <ToolbarButton label="Viewport size" kind="menu">
        <Icon size={16} uniProps={muted} />
      </ToolbarButton>
      <DropdownMenuContent align="end" side="bottom">
        {choices.map((choice) => (
          <ViewportChoice key={choice.label} {...choice} browserId={browserId} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function ViewportChoice({
  label,
  width,
  height,
  browserId,
}: {
  label: string;
  width: number | null;
  height: number | null;
  browserId: string;
}) {
  const select = useCallback(
    () =>
      useBrowserStore
        .getState()
        .setBrowserViewport(
          browserId,
          width && height ? createFixedBrowserViewport(width, height) : { mode: "responsive" },
        ),
    [browserId, height, width],
  );
  return <DropdownMenuItem onSelect={select}>{label}</DropdownMenuItem>;
}
