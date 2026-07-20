import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";

export type ContextSidebarTab = "context" | "findings";

interface ContextSidebarTabsProps {
  active: ContextSidebarTab;
  findingCount: number;
  onChange: (tab: ContextSidebarTab) => void;
}

/**
 * Splits the lower half of the sidebar into the load graph and the fix list.
 * Plain SegmentedControl, same as the Metrics tabs.
 *
 * The findings segment takes the `warning` tone while it holds anything — the
 * mode chip's amber, not a treatment of its own. That is the whole signal:
 * findings moved out of the summary, so something has to mark that there is a
 * reason to look. With nothing to fix it is an ordinary segment.
 */
export function ContextSidebarTabs({
  active,
  findingCount,
  onChange,
}: ContextSidebarTabsProps): ReactElement {
  const { t } = useTranslation();

  const options = useMemo<SegmentedControlOption<ContextSidebarTab>[]>(
    () => [
      {
        value: "context",
        label: t("contextManagement.tabs.context"),
        testID: "context-sidebar-tab-context",
      },
      {
        value: "findings",
        label:
          findingCount > 0
            ? t("contextManagement.tabs.findingsCount", { count: findingCount })
            : t("contextManagement.tabs.findings"),
        tone: findingCount > 0 ? "warning" : undefined,
        testID: "context-sidebar-tab-findings",
      },
    ],
    [findingCount, t],
  );

  return (
    <View style={styles.row}>
      <SegmentedControl
        options={options}
        value={active}
        onValueChange={onChange}
        size="sm"
        stretch
        testID="context-sidebar-tabs"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
}));
