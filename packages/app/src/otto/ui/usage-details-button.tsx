import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRetainedPanelActive } from "@/components/retained-panel";

// Match the attachment + trigger; the shared menu owns anchoring, dismissal and mobile input.
const triggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, pressed, open }) => [
  styles.button,
  (hovered || pressed || open) && styles.buttonHovered,
];

export function UsageDetailsButton({
  label,
  tooltip,
  glyph,
  children,
}: {
  label: string;
  tooltip: string;
  glyph: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const active = useRetainedPanelActive();
  const handleOpenChange = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={0} enabledOnDesktop={active && !open} enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            style={triggerStyle}
            accessibilityRole="button"
            accessibilityLabel={label}
            testID="context-window-meter"
          >
            {glyph}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      {open ? children : null}
    </DropdownMenu>
  );
}

export function UsageDetailsPopup({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuContent
      side="top"
      align="center"
      offset={8}
      minWidth={220}
      maxWidth={360}
      maxHeight={480}
      scrollable
      testID="context-window-popup"
    >
      <View style={styles.content} testID="context-window-details">
        {children}
      </View>
    </DropdownMenuContent>
  );
}
const styles = StyleSheet.create((theme) => ({
  button: {
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: { backgroundColor: theme.colors.surface2 },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  content: { padding: theme.spacing[3], gap: theme.spacing[3] },
}));
