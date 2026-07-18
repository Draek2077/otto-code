import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  SHEET_HORIZONTAL_PADDING_SCALE,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";

// A tabbed dialog opens at a stable bounded height so it does not resize as the
// user switches tabs (each tab has a different natural height). The tab content
// fills that height and scrolls internally; the title, tab strip, and footer
// stay pinned. Callers can override both dimensions.
const DEFAULT_TABBED_DESKTOP_HEIGHT = 600;
// Single detent, so the mobile bottom sheet is the same size on every tab.
const DEFAULT_TABBED_SNAP_POINTS = ["85%"];

const styles = StyleSheet.create((theme) => ({
  // Fixed strip between the sheet header and the scrolling tab content. Row
  // direction keeps the segmented control at its intrinsic width and aligned to
  // the leading edge. Horizontal padding matches the sheet body indent.
  tabStrip: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingTop: theme.spacing[4],
  },
  // Fills the sheet's static content area so the ScrollView — and only the
  // ScrollView — takes the overflow, leaving the footer pinned below.
  tabScroll: {
    flex: 1,
    minHeight: 0,
  },
  tabScrollContent: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    flexGrow: 1,
  },
}));

export interface TabScrollViewProps {
  children: ReactNode;
  /**
   * Render the themed desktop-web scrollbar overlay instead of the native
   * browser scrollbar. No-op on native and on the mobile bottom sheet.
   */
  webScrollbar?: boolean;
}

/**
 * Per-tab scroll container: fills the bounded height of a `scrollable={false}`
 * `AdaptiveModalSheet` and owns its own scrolling, so any action bar pinned
 * around it (the sheet footer, a per-tab toolbar) stays put while the tab
 * content scrolls. Horizontal/top padding is supplied by the sheet's static
 * content wrapper; this container adds only the inter-field gap and a small
 * bottom inset.
 */
export function TabScrollView({ children, webScrollbar = false }: TabScrollViewProps) {
  const isCompact = useIsCompactFormFactor();
  const showWebScrollbar = isWeb && !isCompact && webScrollbar;
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: showWebScrollbar });

  return (
    <View style={styles.tabScroll}>
      <ScrollView
        ref={scrollRef}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showWebScrollbar}
      >
        {children}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

export interface TabbedModalSheetProps<T extends string> {
  header: SheetHeader;
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  /** The tabs shown in the pinned strip below the title. */
  tabs: SegmentedControlOption<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  /**
   * Content for the active tab. Switch on `activeTab` to render the right pane;
   * it is wrapped in an internal per-tab `ScrollView` that fills the bounded
   * height and scrolls, so the title, tabs, and footer stay pinned.
   */
  children: ReactNode;
  /** Sticky footer (e.g. Cancel / Save) pinned below the tab content. */
  footer?: ReactNode;
  /**
   * Fixed desktop card height. Defaults to a bounded height so the dialog does
   * not resize when switching tabs.
   */
  desktopHeight?: number;
  desktopMaxWidth?: number;
  /**
   * Mobile snap points. Defaults to a single tall detent so the sheet is the
   * same size on every tab.
   */
  snapPoints?: string[];
  /**
   * Render the themed desktop-web scrollbar overlay over the tab content
   * instead of the native browser scrollbar.
   */
  webScrollbar?: boolean;
  tabsTestID?: string;
  testID?: string;
}

/**
 * A dialog whose body is tabbed. Builds the full hybrid layout on top of
 * `AdaptiveModalSheet`: a pinned title, a pinned tab strip, per-tab content
 * that scrolls internally, and a pinned footer — a centered card on desktop and
 * a bottom sheet on mobile, both at a stable bounded height. Reach for this
 * instead of stacking tabs and action buttons inside a scrolling body (where
 * they scroll out of view). For a non-tabbed dialog, use `AdaptiveModalSheet`
 * directly with its `footer`/`subHeader` slots.
 */
export function TabbedModalSheet<T extends string>({
  header,
  visible,
  onClose,
  onDismiss,
  tabs,
  activeTab,
  onTabChange,
  children,
  footer,
  desktopHeight = DEFAULT_TABBED_DESKTOP_HEIGHT,
  desktopMaxWidth,
  snapPoints,
  webScrollbar = false,
  tabsTestID,
  testID,
}: TabbedModalSheetProps<T>) {
  const resolvedSnapPoints = useMemo(() => snapPoints ?? DEFAULT_TABBED_SNAP_POINTS, [snapPoints]);
  const tabStrip = useMemo(
    () => (
      <View style={styles.tabStrip}>
        <SegmentedControl
          size="sm"
          value={activeTab}
          onValueChange={onTabChange}
          options={tabs}
          testID={tabsTestID}
        />
      </View>
    ),
    [activeTab, onTabChange, tabs, tabsTestID],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      subHeader={tabStrip}
      footer={footer}
      scrollable={false}
      desktopHeight={desktopHeight}
      desktopMaxWidth={desktopMaxWidth}
      snapPoints={resolvedSnapPoints}
      testID={testID}
    >
      {/* Key on the active tab so switching resets the scroll to the top. */}
      <TabScrollView key={activeTab} webScrollbar={webScrollbar}>
        {children}
      </TabScrollView>
    </AdaptiveModalSheet>
  );
}
