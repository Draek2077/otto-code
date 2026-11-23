import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ScrollView, View, type LayoutChangeEvent } from "react-native";
import { ResizeHandle } from "@/components/resize-handle";
import { Alert } from "@/components/ui/alert";
import { contextLayoutPreferences } from "./layout-store";
import { contextReadingWidth, contextSummaryRatio } from "./layout-preferences";
import { styles } from "./styles";

interface LayoutProps {
  compact: boolean;
  header: ReactNode;
  tree: ReactNode;
  detail: ReactNode;
}
function DesktopContextLayout({ header, tree, detail }: Omit<LayoutProps, "compact">) {
  const [model] = useState(contextLayoutPreferences);
  const preference = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    void model.load();
  }, [model]);
  const [geometry, setGeometry] = useState({ width: 0, height: 0 });
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewRatio, setPreviewRatio] = useState<number | null>(null);
  const available = Math.max(0, geometry.width - 1);
  const width = contextReadingWidth(previewWidth ?? preference.width, available);
  const ratio = contextSummaryRatio(previewRatio ?? preference.summaryRatio);
  const measure = useCallback((event: LayoutChangeEvent) => {
    const { width: measuredWidth, height } = event.nativeEvent.layout;
    // Parking/hidden geometry cannot overwrite a user's desktop reading preference.
    if (measuredWidth > 0 && height > 0) setGeometry({ width: measuredWidth, height });
  }, []);
  const widthSizes = useMemo(
    () => (available > 0 ? [width / available, 1 - width / available] : [0.5, 0.5]),
    [width, available],
  );
  const heightSizes = useMemo(() => [ratio, 1 - ratio], [ratio]);
  const widthPreview = useCallback(
    (_group: string, sizes: number[]) => {
      if (available > 0 && preference.loaded)
        setPreviewWidth(contextReadingWidth((sizes[0] ?? 0.5) * available, available));
    },
    [available, preference.loaded],
  );
  const widthCommit = useCallback(
    (_group: string, sizes: number[]) => {
      if (available > 0 && preference.loaded)
        void model.set({ width: contextReadingWidth((sizes[0] ?? 0.5) * available, available) });
      setPreviewWidth(null);
    },
    [available, model, preference.loaded],
  );
  const heightPreview = useCallback(
    (_group: string, sizes: number[]) => {
      if (geometry.height > 0 && preference.loaded)
        setPreviewRatio(contextSummaryRatio(sizes[0] ?? 0.5));
    },
    [geometry.height, preference.loaded],
  );
  const heightCommit = useCallback(
    (_group: string, sizes: number[]) => {
      if (geometry.height > 0 && preference.loaded)
        void model.set({ summaryRatio: contextSummaryRatio(sizes[0] ?? 0.5) });
      setPreviewRatio(null);
    },
    [geometry.height, model, preference.loaded],
  );
  const sidebarStyle = useMemo(() => [styles.readingSidebar, { width }], [width]);
  const headerStyle = useMemo(
    () => [styles.readingSummary, { height: Math.max(0, geometry.height - 1) * ratio }],
    [geometry.height, ratio],
  );
  return (
    <View style={[styles.content, styles.desktop]}>
      {preference.error ? <Alert variant="warning" description={preference.error} /> : null}
      <View style={styles.readingSplit} onLayout={measure}>
        <View style={sidebarStyle} testID="context-reading-sidebar">
          <ScrollView
            style={headerStyle}
            contentContainerStyle={styles.paneContent}
            testID="context-reading-summary"
          >
            {header}
          </ScrollView>
          <ResizeHandle
            direction="vertical"
            groupId="context-summary"
            index={0}
            sizes={heightSizes}
            containerSize={geometry.height - 1}
            onPreviewResizeSplit={heightPreview}
            onResizeSplit={heightCommit}
            testID="context-summary-splitter"
          />
          <ScrollView style={styles.page} contentContainerStyle={styles.readingTreeContent}>
            {tree}
          </ScrollView>
        </View>
        <ResizeHandle
          direction="horizontal"
          groupId="context-reading"
          index={0}
          sizes={widthSizes}
          containerSize={available}
          onPreviewResizeSplit={widthPreview}
          onResizeSplit={widthCommit}
          testID="context-reading-splitter"
        />
        <ScrollView style={styles.readingDetail} contentContainerStyle={styles.paneContent}>
          {detail}
        </ScrollView>
      </View>
    </View>
  );
}
/** Independent reading panes reuse Paseo's pointer/touch splitter. Compact remains a drill-down. */
export function ContextLayout({ compact, header, tree, detail }: LayoutProps) {
  if (compact)
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        {header}
        {tree}
        {detail}
      </ScrollView>
    );
  return <DesktopContextLayout header={header} tree={tree} detail={detail} />;
}
