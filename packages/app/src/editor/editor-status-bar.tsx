import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getLanguageDisplayName } from "@otto-code/highlight";
import type { CodeDiagnostic, FileEol } from "@otto-code/protocol/messages";
import {
  Abc,
  DataObject,
  HardDrive,
  Image as ImageIcon,
  Pilcrow,
  TextSelectStart,
} from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
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
const ThemedImage = withUnistyles(ImageIcon);

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
  /**
   * Natural pixel size of a previewed image. Null for everything else — and for
   * an image whose container we could not measure, where an invented size would
   * be worse than a missing one.
   */
  imageDimensions?: { width: number; height: number } | null;
  /**
   * Problems the language servers found. Rendered as per-severity totals at the far right,
   * behind a divider, and absent entirely when there are none — a clean file earns no
   * chrome, and a count of zero would be indistinguishable from a file nothing analysed.
   */
  diagnostics?: readonly CodeDiagnostic[];
}

/** Totals per severity, most severe first, skipping the ones at zero. */
function diagnosticTotals(
  diagnostics: readonly CodeDiagnostic[],
): { severity: CodeDiagnostic["severity"]; count: number }[] {
  const order: CodeDiagnostic["severity"][] = ["error", "warning", "info", "hint"];
  return order
    .map((severity) => ({
      severity,
      count: diagnostics.filter((entry) => entry.severity === severity).length,
    }))
    .filter((entry) => entry.count > 0);
}

/**
 * Same tokens the squiggle and the gutter glyph use, so one problem is one colour wherever
 * it appears. `hint` is the muted foreground rather than a fifth hue, on purpose — a hint is
 * the server being helpful, and giving it its own colour would let advice compete with
 * failures for attention.
 */
const SEVERITY_DOT_STYLE: Readonly<
  Record<CodeDiagnostic["severity"], "dotError" | "dotWarning" | "dotInfo" | "dotHint">
> = {
  error: "dotError",
  warning: "dotWarning",
  info: "dotInfo",
  hint: "dotHint",
};

// Written into each variant rather than composed at the call site — an inline style array
// is a new array per render, which the react-perf rule rejects as a prop.
const SEVERITY_DOT = { width: 7, height: 7, borderRadius: 999, flexShrink: 0 } as const;

const SEVERITY_NOUN: Readonly<Record<CodeDiagnostic["severity"], [string, string]>> = {
  error: ["error", "errors"],
  warning: ["warning", "warnings"],
  info: ["suggestion", "suggestions"],
  hint: ["hint", "hints"],
};

/**
 * One severity's total, with a tooltip that says what it is.
 *
 * A coloured dot and a number is unreadable on its own — the whole reason this bar needed
 * fixing was that severity was being carried by colour alone. `info` reads as "suggestion"
 * rather than "info", which is what a language server actually means by it.
 */
function SeverityTotal({
  severity,
  count,
}: {
  severity: CodeDiagnostic["severity"];
  count: number;
}) {
  const [singular, plural] = SEVERITY_NOUN[severity];

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="text"
        accessibilityLabel={`${count} ${count === 1 ? singular : plural}`}
        style={styles.item}
      >
        <View style={styles[SEVERITY_DOT_STYLE[severity]]} />
        <Text style={styles.numericText} numberOfLines={1}>
          {count}
        </Text>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{`${count} ${count === 1 ? singular : plural}`}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorStatusBar({
  path,
  byteSize,
  eol,
  isText,
  cursor,
  imageDimensions,
  diagnostics,
}: EditorStatusBarProps) {
  const iconSize = useIconSize();
  const language = useMemo(() => getLanguageDisplayName(path), [path]);
  const size = useMemo(() => formatFileSize({ size: byteSize }), [byteSize]);
  const totals = useMemo(() => diagnosticTotals(diagnostics ?? []), [diagnostics]);

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
        {/* Problems lead the right-hand group, ahead of the divider: they are a fact about
            the file's health, and the encoding/caret readouts stay rightmost because that is
            where the eye already goes for them. */}
        {totals.map((entry) => (
          <SeverityTotal key={entry.severity} severity={entry.severity} count={entry.count} />
        ))}
        {totals.length > 0 ? <View style={styles.divider} /> : null}
        {imageDimensions ? (
          <View style={styles.item}>
            <ThemedImage size={iconSize.xs} uniProps={mutedIconColor} />
            <Text style={styles.numericText} numberOfLines={1}>
              {`${imageDimensions.width} × ${imageDimensions.height}`}
            </Text>
          </View>
        ) : null}
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
    // Chrome, not content: every item here reports state, so there is nothing
    // worth selecting and the plain arrow is the honest pointer. Cast because
    // RN's CursorValue only admits "auto" | "pointer" — the repo idiom for a
    // web-only cursor (see explorer-sidebar's resize handle).
    ...(isWeb ? ({ cursor: "default", userSelect: "none" } as object) : {}),
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
  // Separates the problem totals from the caret readout: they are a different kind of
  // fact about the file, and without a rule they read as one run of numbers.
  divider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: theme.spacing[1],
    backgroundColor: theme.colors.border,
    flexShrink: 0,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  dotError: { ...SEVERITY_DOT, backgroundColor: theme.colors.statusDanger },
  dotWarning: { ...SEVERITY_DOT, backgroundColor: theme.colors.statusWarning },
  dotInfo: { ...SEVERITY_DOT, backgroundColor: theme.colors.statusInfo },
  dotHint: { ...SEVERITY_DOT, backgroundColor: theme.colors.foregroundMuted },
}));
