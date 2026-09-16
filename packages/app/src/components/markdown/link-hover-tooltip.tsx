import type { ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type LinkHoverTone = "muted" | "error";

interface LinkHoverTooltipProps {
  /** The underlying target: a URL, a resolved path, or the raw href. */
  label: string;
  hint?: string;
  hintTone?: LinkHoverTone;
  /** Modifier keys rendered before the hint, e.g. `["mod"]`. */
  hintKeys?: ShortcutKey[];
  children: ReactNode;
}

const TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it at runtime, which keeps
  // the tooltip wrapper from breaking inline link flow.
  display: "inline-flex" as ViewStyle["display"],
};

/**
 * Hover tooltip for every rendered markdown link: shows what the link really
 * points at. Web only - hover does not exist on native.
 */
export function LinkHoverTooltip({
  label,
  hint,
  hintTone = "muted",
  hintKeys,
  children,
}: LinkHoverTooltipProps) {
  if (!isWeb) {
    return children;
  }
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <View style={TRIGGER_STYLE}>{children}</View>
      </TooltipTrigger>
      {label ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <View style={styles.body}>
            <Text selectable={false} style={styles.label}>
              {label}
            </Text>
            {hint ? (
              <View style={styles.hintRow}>
                {hintKeys ? <Shortcut keys={hintKeys} /> : null}
                <Text
                  selectable={false}
                  style={hintTone === "error" ? styles.hintError : styles.hint}
                >
                  {hint}
                </Text>
              </View>
            ) : null}
          </View>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  hintError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
}));
