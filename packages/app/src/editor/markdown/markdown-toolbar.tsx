import { useCallback, useMemo } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  AddLink,
  Checklist,
  CodeBlocks,
  FormatBold,
  FormatH1,
  FormatH2,
  FormatH3,
  FormatItalic,
  FormatListBulleted,
  FormatListNumbered,
  FormatQuote,
  FormatStrikethrough,
  HorizontalRule,
  Image as ImageIcon,
  TableChart,
  TableRows,
  ViewColumn,
  AddRowBelow,
  AddColumnRight,
  FormatAlignCenter,
} from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import type { KeyboardActionId } from "@/keyboard/actions";
import { compactUp, type Theme } from "@/styles/theme";
import type { MarkdownCommandName } from "../editor-contract";
import { isMarkdownPath } from "./markdown-path";
import type { IconSizeProp } from "@/components/icons/icon-size";

// Each icon is wrapped individually: `withUnistyles` wraps LEAVES, so only the
// glyph re-renders on a theme change rather than the whole strip.
const ThemedFormatBold = withUnistyles(FormatBold);
const ThemedFormatItalic = withUnistyles(FormatItalic);
const ThemedFormatStrikethrough = withUnistyles(FormatStrikethrough);
const ThemedCodeBlocks = withUnistyles(CodeBlocks);
const ThemedFormatH1 = withUnistyles(FormatH1);
const ThemedFormatH2 = withUnistyles(FormatH2);
const ThemedFormatH3 = withUnistyles(FormatH3);
const ThemedFormatListBulleted = withUnistyles(FormatListBulleted);
const ThemedFormatListNumbered = withUnistyles(FormatListNumbered);
const ThemedChecklist = withUnistyles(Checklist);
const ThemedFormatQuote = withUnistyles(FormatQuote);
const ThemedAddLink = withUnistyles(AddLink);
const ThemedImage = withUnistyles(ImageIcon);
const ThemedTableChart = withUnistyles(TableChart);
const ThemedHorizontalRule = withUnistyles(HorizontalRule);
const ThemedAddRowBelow = withUnistyles(AddRowBelow);
const ThemedAddColumnRight = withUnistyles(AddColumnRight);
const ThemedTableRows = withUnistyles(TableRows);
const ThemedViewColumn = withUnistyles(ViewColumn);
const ThemedFormatAlignCenter = withUnistyles(FormatAlignCenter);

// The markdown formatting strip, shown above the editor for markdown files.
//
// On a phone this is not a convenience, it is the ONLY affordance: there are no
// chords on a touch keyboard, so every command that has a key on desktop must
// also have a button here. That is why the strip scrolls horizontally rather
// than collapsing into an overflow menu - a menu would bury the two or three
// buttons people actually reach for behind a tap.

type ToolbarIcon = typeof ThemedFormatBold;

interface ToolbarItem {
  command: MarkdownCommandName;
  Icon: ToolbarIcon;
  labelKey: string;
}

interface ToolbarGroup {
  key: string;
  items: ToolbarItem[];
}

// Grouped by what the command does to the text, in the order a document is
// usually built: emphasis, then structure, then things you insert.
const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    key: "inline",
    items: [
      { command: "markdownBold", Icon: ThemedFormatBold, labelKey: "editor.markdownToolbar.bold" },
      {
        command: "markdownItalic",
        Icon: ThemedFormatItalic,
        labelKey: "editor.markdownToolbar.italic",
      },
      {
        command: "markdownStrikethrough",
        Icon: ThemedFormatStrikethrough,
        labelKey: "editor.markdownToolbar.strikethrough",
      },
      { command: "markdownCode", Icon: ThemedCodeBlocks, labelKey: "editor.markdownToolbar.code" },
    ],
  },
  {
    key: "headings",
    items: [
      {
        command: "markdownHeading1",
        Icon: ThemedFormatH1,
        labelKey: "editor.markdownToolbar.heading1",
      },
      {
        command: "markdownHeading2",
        Icon: ThemedFormatH2,
        labelKey: "editor.markdownToolbar.heading2",
      },
      {
        command: "markdownHeading3",
        Icon: ThemedFormatH3,
        labelKey: "editor.markdownToolbar.heading3",
      },
    ],
  },
  {
    key: "blocks",
    items: [
      {
        command: "markdownBulletList",
        Icon: ThemedFormatListBulleted,
        labelKey: "editor.markdownToolbar.bulletList",
      },
      {
        command: "markdownOrderedList",
        Icon: ThemedFormatListNumbered,
        labelKey: "editor.markdownToolbar.orderedList",
      },
      {
        command: "markdownTaskList",
        Icon: ThemedChecklist,
        labelKey: "editor.markdownToolbar.taskList",
      },
      {
        command: "markdownBlockquote",
        Icon: ThemedFormatQuote,
        labelKey: "editor.markdownToolbar.blockquote",
      },
    ],
  },
  {
    key: "insert",
    items: [
      { command: "markdownLink", Icon: ThemedAddLink, labelKey: "editor.markdownToolbar.link" },
      { command: "markdownImage", Icon: ThemedImage, labelKey: "editor.markdownToolbar.image" },
      {
        command: "markdownTable",
        Icon: ThemedTableChart,
        labelKey: "editor.markdownToolbar.table",
      },
      {
        command: "markdownHorizontalRule",
        Icon: ThemedHorizontalRule,
        labelKey: "editor.markdownToolbar.horizontalRule",
      },
    ],
  },
  {
    key: "table",
    items: [
      {
        command: "markdownTableFormat",
        Icon: ThemedTableChart,
        labelKey: "editor.markdownToolbar.tableFormat",
      },
      {
        command: "markdownTableRowBelow",
        Icon: ThemedAddRowBelow,
        labelKey: "editor.markdownToolbar.tableRowBelow",
      },
      {
        command: "markdownTableRowDelete",
        Icon: ThemedTableRows,
        labelKey: "editor.markdownToolbar.tableRowDelete",
      },
      {
        command: "markdownTableColumnRight",
        Icon: ThemedAddColumnRight,
        labelKey: "editor.markdownToolbar.tableColumnRight",
      },
      {
        command: "markdownTableColumnDelete",
        Icon: ThemedViewColumn,
        labelKey: "editor.markdownToolbar.tableColumnDelete",
      },
      {
        command: "markdownTableAlign",
        Icon: ThemedFormatAlignCenter,
        labelKey: "editor.markdownToolbar.tableAlign",
      },
    ],
  },
];

const MARKDOWN_SHORTCUT_ACTIONS: Partial<Record<MarkdownCommandName, KeyboardActionId>> = {
  markdownBold: "editor.markdown.bold",
  markdownItalic: "editor.markdown.italic",
  markdownStrikethrough: "editor.markdown.strikethrough",
  markdownCode: "editor.markdown.code",
  markdownBulletList: "editor.markdown.bulletList",
  markdownOrderedList: "editor.markdown.orderedList",
  markdownTaskList: "editor.markdown.taskList",
  markdownBlockquote: "editor.markdown.blockquote",
  markdownLink: "editor.markdown.link",
};

const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function ToolbarButton({
  command,
  Icon,
  label,
  iconSize,
  onRun,
}: {
  command: MarkdownCommandName;
  Icon: ToolbarIcon;
  label: string;
  iconSize: IconSizeProp;
  onRun: (command: MarkdownCommandName) => void;
}) {
  const handlePress = useCallback(() => {
    onRun(command);
  }, [command, onRun]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) && styles.buttonHovered,
    ],
    [],
  );
  const shortcutDiscoveryAction = MARKDOWN_SHORTCUT_ACTIONS[command];
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={`markdown-toolbar-${command}`}
        onPress={handlePress}
        style={buttonStyle}
      >
        <View style={styles.shortcutDiscoveryAnchor}>
          <Icon size={iconSize} uniProps={iconColorMapping} />
          {shortcutDiscoveryAction ? (
            <ShortcutDiscoveryHint
              action={shortcutDiscoveryAction}
              style={styles.shortcutDiscoveryHint}
            />
          ) : null}
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export interface MarkdownToolbarProps {
  onRun: (command: MarkdownCommandName) => void;
}

/**
 * The toolbar for a given file, or nothing when that file is not markdown.
 *
 * The path test lives here rather than at the call site so the file pane does
 * not grow another branch for a component that already knows whether it applies.
 */
export function MarkdownToolbarForPath({
  path,
  ...props
}: {
  path: string;
} & MarkdownToolbarProps) {
  if (!isMarkdownPath(path)) {
    return null;
  }
  return <MarkdownToolbar {...props} />;
}

export function MarkdownToolbar({ onRun }: MarkdownToolbarProps) {
  const { t } = useTranslation();
  // Doubled on compact like every other icon-only control, which here is also
  // what makes the buttons a real touch target.
  const groups = useMemo(() => TOOLBAR_GROUPS, []);

  return (
    <View style={styles.bar} testID="markdown-toolbar">
      {/* Everything here formats a SELECTION. The one control that changed the
          whole document, the live-preview toggle, moved to the file view mode
          bar, where people were already looking for it: it belongs with the
          view switch, not with bold and italic. See docs/text-editor.md. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scrollContent}
        accessibilityLabel={t("editor.markdownToolbar.label")}
      >
        {groups.map((group, index) => (
          <View key={group.key} style={styles.group}>
            {index > 0 ? <View style={styles.separator} /> : null}
            {group.items.map((item) => (
              <ToolbarButton
                key={item.command}
                command={item.command}
                Icon={item.Icon}
                label={t(item.labelKey)}
                iconSize="md"
                onRun={onRun}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: compactUp(theme.spacing[1]),
    paddingVertical: compactUp(2),
    gap: 2,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  separator: {
    width: 1,
    alignSelf: "stretch",
    marginHorizontal: compactUp(theme.spacing[1]),
    marginVertical: compactUp(4),
    backgroundColor: theme.colors.border,
  },
  button: {
    padding: compactUp(theme.spacing[1]),
    borderRadius: compactUp(6),
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  shortcutDiscoveryAnchor: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
