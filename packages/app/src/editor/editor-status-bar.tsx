import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getLanguageDisplayName } from "@otto-code/highlight";
import type { FileEol } from "@otto-code/protocol/messages";
import {
  Abc,
  DataObject,
  HardDrive,
  Pilcrow,
  TextSelectStart,
} from "@/components/icons/material-icons";
import { useIconSize, type Theme } from "@/styles/theme";
import { formatFileSize, utf8ByteSize } from "@/utils/format-file-size";
import type { EditorBufferState } from "./editor-buffer-state";
import type { EditorCursorPosition } from "./editor-contract";

// The strip along the bottom of the editor: what the file is on the left, how
// it is encoded and where the caret sits on the right. Read-only — every item
// reports state rather than offering an action, so nothing here is pressable.

// Text is decoded as UTF-8 by the daemon unconditionally (file-explorer
// service), with no charset sniffing anywhere in the stack. This label states
// what we actually did, so it is a constant rather than a detected value — if
// real detection ever lands, this is the one place that has to change.
const ENCODING_LABEL = "UTF-8";

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedDataObject = withUnistyles(DataObject);
const ThemedHardDrive = withUnistyles(HardDrive);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedAbc = withUnistyles(Abc);
const ThemedTextSelectStart = withUnistyles(TextSelectStart);

/** Ln/Col, plus a selection summary when there is one — VS Code's phrasing. */
function formatCursor(cursor: EditorCursorPosition): string {
  const position = `Ln ${cursor.line}, Col ${cursor.column}`;
  if (cursor.selectedChars === 0) {
    return position;
  }
  if (cursor.selectedLines > 1) {
    return `${position} (${cursor.selectedLines} lines, ${cursor.selectedChars} selected)`;
  }
  return `${position} (${cursor.selectedChars} selected)`;
}

/**
 * Disk size of an editor buffer; 0 before it has loaded.
 *
 * Keyed on the baseline (load/save/rebaseline), not the live document: this is
 * the size on disk, and recomputing it per keystroke would walk the whole file
 * for a number that describes the file rather than the draft. A hook rather
 * than a plain call so the host carries neither the memo nor the null branch —
 * `file-tab-pane` has no cyclomatic-complexity budget to spare.
 */
export function useBufferByteSize(buffer: EditorBufferState | null): number {
  const baseline = buffer?.baseline;
  return useMemo(() => (baseline ? utf8ByteSize(baseline.content, baseline.eol) : 0), [baseline]);
}

interface EditorStatusBarProps {
  /** Workspace-relative path; drives the language label only. */
  path: string;
  /** Bytes on disk. */
  byteSize: number;
  /**
   * Null hides the item — either the file has no line endings (image, binary)
   * or the read path never reported them.
   */
  eol: FileEol | null;
  /**
   * False for images and binaries: we never decoded them as text, so claiming
   * an encoding for them would be a lie.
   */
  isText: boolean;
  /** Null in preview mode, and until the editor reports its first position. */
  cursor: EditorCursorPosition | null;
}

export function EditorStatusBar({ path, byteSize, eol, isText, cursor }: EditorStatusBarProps) {
  const iconSize = useIconSize();
  const language = useMemo(() => getLanguageDisplayName(path), [path]);
  const size = useMemo(() => formatFileSize({ size: byteSize }), [byteSize]);

  return (
    <View style={styles.container} testID="editor-status-bar">
      <View style={styles.group}>
        <View style={styles.item}>
          <ThemedDataObject size={iconSize.xs} uniProps={mutedIconColor} />
          <Text style={styles.text} numberOfLines={1}>
            {language}
          </Text>
        </View>
        <View style={styles.item}>
          <ThemedHardDrive size={iconSize.xs} uniProps={mutedIconColor} />
          <Text style={styles.text} numberOfLines={1}>
            {size}
          </Text>
        </View>
      </View>
      <View style={styles.group}>
        {eol ? (
          <View style={styles.item}>
            <ThemedPilcrow size={iconSize.xs} uniProps={mutedIconColor} />
            <Text style={styles.text} numberOfLines={1}>
              {eol.toUpperCase()}
            </Text>
          </View>
        ) : null}
        {isText ? (
          <View style={styles.item}>
            <ThemedAbc size={iconSize.xs} uniProps={mutedIconColor} />
            <Text style={styles.text} numberOfLines={1}>
              {ENCODING_LABEL}
            </Text>
          </View>
        ) : null}
        {cursor ? (
          <View style={styles.item}>
            <ThemedTextSelectStart size={iconSize.xs} uniProps={mutedIconColor} />
            <Text style={styles.numericText} numberOfLines={1}>
              {formatCursor(cursor)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    // minHeight, not height: the compact form factor scales the font up and
    // this must not clip.
    minHeight: 24,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  numericText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    // Stops the whole bar twitching sideways as the caret moves.
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
}));
