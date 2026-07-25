import { useMemo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";

export type ContextSidebarTab = "context" | "findings" | "memory";

interface ContextSidebarTabsProps {
  active: ContextSidebarTab;
  findingCount: number;
  /**
   * Lessons the selected personality holds. `null` = this host cannot store
   * lessons at all, and the Memory segment is absent rather than empty.
   */
  lessonCount: number | null;
  onChange: (tab: ContextSidebarTab) => void;
  /**
   * An action over the graph as a whole, parked left of the segments. Compaction
   * lives here rather than in the file toolbar because it is not about the file
   * on screen: it opens a job carrying the whole context graph, with the rest of
   * the graph as read-only references. The file toolbar's Refine is the
   * single-file action, and keeping them apart is what makes that difference
   * visible.
   */
  leading?: ReactNode;
}

/**
 * Splits the lower half of the sidebar into the load graph, the fix list, and —
 * on a host that stores them — the selected personality's remembered lessons.
 * Plain SegmentedControl, same as the Metrics tabs.
 *
 * The findings segment takes the `warning` tone while it holds anything — the
 * mode chip's amber, not a treatment of its own. That is the whole signal:
 * findings moved out of the summary, so something has to mark that there is a
 * reason to look. With nothing to fix it is an ordinary segment.
 *
 * Memory carries a plain count and never a tone. Lessons are not a problem to
 * fix, and amber here would read as "this personality has learned something
 * wrong" — which is a judgement this row has no way to make.
 */
export function ContextSidebarTabs({
  active,
  findingCount,
  lessonCount,
  onChange,
  leading,
}: ContextSidebarTabsProps): ReactElement {
  const { t } = useTranslation();

  const options = useMemo<SegmentedControlOption<ContextSidebarTab>[]>(() => {
    const segments: SegmentedControlOption<ContextSidebarTab>[] = [
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
    ];
    if (lessonCount !== null) {
      segments.push({
        value: "memory",
        label: lessonCount > 0 ? `Memory (${lessonCount})` : "Memory",
        testID: "context-sidebar-tab-memory",
      });
    }
    return segments;
  }, [findingCount, lessonCount, t]);

  return (
    <View style={styles.row}>
      {leading}
      <View style={styles.segments}>
        <SegmentedControl
          options={options}
          value={active}
          onValueChange={onChange}
          size="sm"
          stretch
          testID="context-sidebar-tabs"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  // The segments keep the whole remaining width, so adding the action does not
  // shrink them into two half-labels.
  segments: {
    flex: 1,
    minWidth: 0,
  },
}));
