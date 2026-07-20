import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { formatTokens } from "./format";
import type { InboundEdge } from "./graph-model";

type LoadMode = "always" | "link";

interface LoadModeControlProps {
  inbound: InboundEdge;
  /** Tokens this file would add to, or remove from, every request. */
  estTokens: number;
  /** False on providers with no import mechanism — the control explains why. */
  supportsImports: boolean;
  busy: boolean;
  onConvert: (target: "import" | "reference") => void;
  /**
   * `toolbar` rides inside the file pane's toolbar and brings no chrome of its
   * own. `strip` is the standalone bar above the pane, used on phones where the
   * toolbar has no width to spare.
   */
  layout: "toolbar" | "strip";
}

/**
 * The single most valuable operation in the tool: flip one reference between
 * riding every request and being a link the agent may follow.
 *
 * Deliberately never says "import". Users should not have to learn a provider's
 * syntax to control their own bill, and the delta is stated up front so the
 * choice is informed rather than a leap.
 *
 * On desktop it rides inside the file pane's toolbar — a second full-width bar
 * cost a row of height to say two words. On a phone that toolbar is already at
 * its limit, so the strip comes back rather than squeezing both into one row.
 */
export function LoadModeControl({
  inbound,
  estTokens,
  supportsImports,
  busy,
  onConvert,
  layout,
}: LoadModeControlProps): ReactElement {
  const { t } = useTranslation();
  const isAlwaysLoaded = inbound.edge.kind === "import";
  const rootStyle = layout === "strip" ? styles.rootStrip : styles.root;

  const options = useMemo<SegmentedControlOption<LoadMode>[]>(
    () => [
      {
        value: "always",
        label: t("contextManagement.loadMode.always"),
        disabled: busy,
        testID: "context-load-mode-always",
      },
      {
        value: "link",
        label: t("contextManagement.loadMode.linkOnly"),
        disabled: busy,
        testID: "context-load-mode-link",
      },
    ],
    [busy, t],
  );

  const handleChange = useCallback(
    (next: LoadMode) => onConvert(next === "always" ? "import" : "reference"),
    [onConvert],
  );

  if (!supportsImports) {
    return (
      <View style={rootStyle}>
        <Text style={styles.hint} numberOfLines={1}>
          {t("contextManagement.loadMode.unsupported")}
        </Text>
      </View>
    );
  }

  return (
    <View style={rootStyle} testID="context-load-mode">
      <SegmentedControl
        options={options}
        value={isAlwaysLoaded ? "always" : "link"}
        onValueChange={handleChange}
        size="sm"
      />
      {/* The delta is the whole point — "saves 4.2K per request" is what makes
          this an informed choice rather than a leap. */}
      <Text style={styles.delta} numberOfLines={1}>
        {isAlwaysLoaded
          ? t("contextManagement.loadMode.saves", { tokens: formatTokens(estTokens) })
          : t("contextManagement.loadMode.adds", { tokens: formatTokens(estTokens) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Toolbar form: no padding or border of its own — the toolbar owns the
  // chrome. It shrinks before the toolbar's own buttons do.
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  // Strip form: its own bar above the pane. Wraps, because on a narrow phone
  // the delta sentence belongs on a second line rather than ellipsized away.
  rootStrip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  delta: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
  hint: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
}));
