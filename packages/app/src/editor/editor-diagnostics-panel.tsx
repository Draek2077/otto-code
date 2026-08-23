import type { CodeDiagnostic } from "@otto-code/protocol/messages";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, CircleAlertFilled, X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { type Theme } from "@/styles/theme";

/**
 * The problems panel: a tinted strip between the document and the status bar, matching the
 * out-of-project banner's idiom - outside the scroll region, so it states something about
 * the file rather than about the part of it you happen to be looking at.
 *
 * **Errors and warnings only.** `tsserver` emits hint-severity suggestions by the dozen on
 * plain JavaScript; a panel that opened for those would be permanent furniture, and
 * permanent furniture is invisible. Hints and info live in the gutter and the status bar,
 * where they cost nothing.
 *
 * Dismissal is deliberately not persisted - see `dismissedFingerprint` in the host. The
 * panel is keyed on the *content* of the problem set, so dismissing hides these problems
 * and a re-evaluation that finds different ones brings it back on its own.
 *
 * Strings are literal English pending the i18n pass; this UI has not been through a design
 * review yet and translating an unconfirmed layout is work done twice.
 */

/** How many problems are listed before the panel stops and counts the rest. */
const LISTED_LIMIT = 3;

const dangerIconColor = (theme: Theme) => ({ color: theme.colors.statusDanger });
const warningIconColor = (theme: Theme) => ({ color: theme.colors.statusWarning });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedCircleAlertFilled = withUnistyles(CircleAlertFilled);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedX = withUnistyles(X);

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
}

export function countBySeverity(diagnostics: readonly CodeDiagnostic[]): DiagnosticCounts {
  const counts: DiagnosticCounts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const entry of diagnostics) {
    if (entry.severity === "error") {
      counts.errors += 1;
    } else if (entry.severity === "warning") {
      counts.warnings += 1;
    } else if (entry.severity === "info") {
      counts.infos += 1;
    } else {
      counts.hints += 1;
    }
  }
  return counts;
}

/**
 * A stable identity for a problem set, so "I dismissed this" survives the redundant
 * republishes a language server makes while you type but not a genuine change.
 *
 * Positions are deliberately excluded. Typing above an error moves it without changing it,
 * and a fingerprint that shifted with every line would make the panel reappear on the next
 * keystroke - which is the one behaviour that would make dismissal useless.
 */
export function diagnosticsFingerprint(diagnostics: readonly CodeDiagnostic[]): string {
  return diagnostics
    .filter((entry) => entry.severity === "error" || entry.severity === "warning")
    .map((entry) => `${entry.severity}\0${entry.code ?? ""}\0${entry.message}`)
    .sort()
    .join("");
}

/** Whether there is anything the panel would show at all. */
export function hasPanelWorthyDiagnostics(diagnostics: readonly CodeDiagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === "error" || entry.severity === "warning");
}

function summarize(counts: DiagnosticCounts): string {
  const parts: string[] = [];
  if (counts.errors > 0) {
    parts.push(`${counts.errors} ${counts.errors === 1 ? "error" : "errors"}`);
  }
  if (counts.warnings > 0) {
    parts.push(`${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`);
  }
  return parts.join(", ");
}

/** The message without the `help:` continuation - the panel is a list, not the detail view. */
function headline(message: string): string {
  const newline = message.indexOf("\n");
  return (newline === -1 ? message : message.slice(0, newline)).trim();
}

/**
 * Whether to show the panel, and how to dismiss it.
 *
 * Dismissal is remembered as the *fingerprint* of what was dismissed, not a boolean. That
 * one choice gives all three behaviours the panel is supposed to have, with no persistence
 * layer and no timers:
 *
 * - **Dismiss hides it** while the problems are the same ones.
 * - **A fresh evaluation brings it back**, because different problems fingerprint differently.
 * - **Reopening the document brings it back**, because the state dies with the component.
 *
 * Deliberately not persisted anywhere. A dismissal that outlived the tab would be a way to
 * permanently hide an error, which is the opposite of the point.
 */
export function useDismissibleProblems(diagnostics: readonly CodeDiagnostic[]): {
  visible: boolean;
  dismiss: () => void;
} {
  const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null);
  const fingerprint = useMemo(() => diagnosticsFingerprint(diagnostics), [diagnostics]);
  const dismiss = useCallback(() => setDismissedFingerprint(fingerprint), [fingerprint]);

  return {
    visible: hasPanelWorthyDiagnostics(diagnostics) && fingerprint !== dismissedFingerprint,
    dismiss,
  };
}

/**
 * One problem. Its own component so the press handler is stable per row rather than a fresh
 * closure on every parent render.
 */
function DiagnosticRow({
  entry,
  onSelectLine,
}: {
  entry: CodeDiagnostic;
  onSelectLine: (line: number) => void;
}) {
  const jump = useCallback(() => onSelectLine(entry.line), [entry.line, onSelectLine]);

  return (
    <Tooltip delayDuration={300}>
      {/* The trigger IS the row: it is already a Pressable, so there is no second
          interactive layer between the pointer and the jump. */}
      <TooltipTrigger
        onPress={jump}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Line ${entry.line}: ${entry.message}`}
        testID="editor-diagnostics-row"
      >
        <Text style={styles.rowLine} numberOfLines={1}>
          {`Ln ${entry.line}`}
        </Text>
        <Text style={styles.rowMessage} numberOfLines={1}>
          {headline(entry.message)}
        </Text>
        {entry.code ? (
          <Text style={styles.rowCode} numberOfLines={1}>
            {entry.code}
          </Text>
        ) : null}
      </TooltipTrigger>
      {/* The row truncates to one line, so the whole message - including the `help:`
          continuation a row cannot show - lives here. */}
      <TooltipContent side="top" align="start" offset={8} maxWidth={480}>
        <View style={styles.tooltipBody}>
          <Text style={styles.tooltipText}>{entry.message}</Text>
          <Text
            style={styles.tooltipMeta}
          >{`${attributionOf(entry)} · Ln ${entry.line}, Col ${entry.column}`}</Text>
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

/** `Error · oxc · eslint(no-unused-vars)` - mirrors the editor hover card's own line. */
function attributionOf(entry: CodeDiagnostic): string {
  const label = entry.severity === "error" ? "Error" : "Warning";
  return [label, entry.source, entry.code]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
}

/** Position AND server, so two servers flagging the same spot stay two rows. */
function rowKey(entry: CodeDiagnostic): string {
  return `${entry.serverId ?? ""}:${entry.line}:${entry.column}:${entry.message}`;
}

export interface EditorDiagnosticsPanelProps {
  /**
   * Whether the panel is showing. Owned here rather than by a conditional at the call site:
   * the host's view function is at its complexity ceiling, and "should this be visible" is
   * this component's own business.
   */
  visible: boolean;
  diagnostics: readonly CodeDiagnostic[];
  /** Jump the caret to a problem's line. */
  onSelectLine: (line: number) => void;
  onDismiss: () => void;
}

export function EditorDiagnosticsPanel({
  visible,
  diagnostics,
  onSelectLine,
  onDismiss,
}: EditorDiagnosticsPanelProps) {
  const listed = diagnostics.filter(
    (entry) => entry.severity === "error" || entry.severity === "warning",
  );
  if (!visible || listed.length === 0) {
    return null;
  }

  const counts = countBySeverity(listed);
  // The panel's whole tone follows the worst thing in it: a file with one error and nine
  // warnings is an error, and tinting it amber would understate that.
  const isDanger = counts.errors > 0;
  const remaining = listed.length - LISTED_LIMIT;

  return (
    <View
      style={isDanger ? styles.panelDanger : styles.panelWarning}
      testID="editor-diagnostics-panel"
    >
      <View style={styles.header}>
        {isDanger ? (
          <ThemedCircleAlertFilled size="xs" uniProps={dangerIconColor} />
        ) : (
          <ThemedAlertTriangle size="xs" uniProps={warningIconColor} />
        )}
        <Text style={isDanger ? styles.summaryDanger : styles.summaryWarning} numberOfLines={1}>
          {summarize(counts)}
        </Text>
        <View style={styles.spacer} />
        <Tooltip delayDuration={300}>
          <TooltipTrigger
            onPress={onDismiss}
            style={styles.dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss problems"
            testID="editor-diagnostics-dismiss"
          >
            <ThemedX size="xs" uniProps={mutedIconColor} />
          </TooltipTrigger>
          {/* The Text wrapper is required, not decoration: TooltipContent renders its
              children raw, so a bare string inherits the web document's font size and
              comes out roughly double. */}
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>Dismiss until these change</Text>
          </TooltipContent>
        </Tooltip>
      </View>

      {listed.slice(0, LISTED_LIMIT).map((entry) => (
        <DiagnosticRow key={rowKey(entry)} entry={entry} onSelectLine={onSelectLine} />
      ))}

      {remaining > 0 ? (
        <Text style={styles.more} numberOfLines={1}>
          {`+${remaining} more`}
        </Text>
      ) : null}
    </View>
  );
}

// Tone variants are written out in full rather than composed with a style array at the call
// site: an inline `[base, variant]` array is a new array every render, which the react-perf
// rule rightly rejects for a prop.
const panelBase = (theme: Theme) => ({
  paddingHorizontal: theme.spacing[3],
  paddingVertical: theme.spacing[1],
  gap: theme.spacing[1],
  borderTopWidth: 1,
});

const summaryBase = (theme: Theme) => ({
  fontSize: theme.fontSize.xs,
  fontWeight: "600" as const,
  flexShrink: 1,
});

const styles = StyleSheet.create((theme) => ({
  panelDanger: {
    ...panelBase(theme),
    backgroundColor: theme.colors.statusDangerSurface,
    borderTopColor: theme.colors.statusDanger,
  },
  panelWarning: {
    ...panelBase(theme),
    backgroundColor: theme.colors.statusWarningSurface,
    borderTopColor: theme.colors.statusWarning,
  },
  summaryDanger: {
    ...summaryBase(theme),
    color: theme.colors.statusDanger,
  },
  summaryWarning: {
    ...summaryBase(theme),
    color: theme.colors.statusWarning,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  spacer: {
    flex: 1,
  },
  dismiss: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  rowLine: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  rowMessage: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  rowCode: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  more: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipBody: {
    gap: theme.spacing[1],
  },
  tooltipMeta: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
}));
