import { useCallback, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Link,
  Image,
  Table,
  Minus,
  Rows3,
  Columns3,
  AlignCenter,
  Eye,
  type LucideIcon,
} from "lucide-react-native";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";
import type { EditorSurface } from "../surface";
import type { MarkdownCommandName } from "./contracts";

interface Item {
  command: MarkdownCommandName;
  label: string;
  icon: LucideIcon;
}
const ITEMS: Item[] = [
  { command: "markdownBold", label: "Bold", icon: Bold },
  { command: "markdownItalic", label: "Italic", icon: Italic },
  { command: "markdownStrikethrough", label: "Strikethrough", icon: Strikethrough },
  { command: "markdownCode", label: "Inline code", icon: Code },
  { command: "markdownHeading1", label: "Heading 1", icon: Heading1 },
  { command: "markdownHeading2", label: "Heading 2", icon: Heading2 },
  { command: "markdownHeading3", label: "Heading 3", icon: Heading3 },
  { command: "markdownBulletList", label: "Bullet list", icon: List },
  { command: "markdownOrderedList", label: "Numbered list", icon: ListOrdered },
  { command: "markdownTaskList", label: "Task list", icon: ListChecks },
  { command: "markdownToggleTask", label: "Toggle task", icon: ListChecks },
  { command: "markdownBlockquote", label: "Block quote", icon: Quote },
  { command: "markdownCodeFence", label: "Code block", icon: Code },
  { command: "markdownLink", label: "Insert link", icon: Link },
  { command: "markdownImage", label: "Insert image link", icon: Image },
  { command: "markdownHorizontalRule", label: "Horizontal rule", icon: Minus },
  { command: "markdownTable", label: "Insert table", icon: Table },
  { command: "markdownTableFormat", label: "Format table", icon: Table },
  { command: "markdownTableRowBelow", label: "Insert row below", icon: Rows3 },
  { command: "markdownTableRowDelete", label: "Delete table row", icon: Rows3 },
  { command: "markdownTableColumnRight", label: "Insert column right", icon: Columns3 },
  { command: "markdownTableColumnDelete", label: "Delete table column", icon: Columns3 },
  { command: "markdownTableAlign", label: "Cycle column alignment", icon: AlignCenter },
];
function Glyph({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon size={16} color={color} />;
}
const ThemedGlyph = withUnistyles(Glyph);
const glyphColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function FormatAction({ item, surface }: { item: Item; surface: EditorSurface }) {
  const apply = useCallback(() => surface.command(item.command), [surface, item]);
  return (
    <ToolbarButton label={item.label} onPress={apply} testID={`editor-${item.command}`}>
      <ThemedGlyph icon={item.icon} uniProps={glyphColor} />
    </ToolbarButton>
  );
}
/** Touch keeps the same commands visible in one horizontally scrolling strip. */
export function EditorMarkdownToolbar({ surface }: { surface: EditorSurface }) {
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const toggle = useCallback(() => surface.toggleMarkdownLivePreview(), [surface]);
  return (
    <View style={styles.bar} testID="editor-markdown-toolbar">
      <ToolbarButton
        label="Formatted Markdown"
        selected={state.markdown.livePreview}
        onPress={toggle}
        testID="editor-markdown-formatted"
      >
        <ThemedGlyph icon={Eye} uniProps={glyphColor} />
      </ToolbarButton>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actions}
      >
        {ITEMS.map((item) => (
          <FormatAction key={item.command} item={item} surface={surface} />
        ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  bar: {
    height: 46,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actions: { alignItems: "center", gap: theme.spacing[1] },
}));
