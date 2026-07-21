import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { GitBlameCommit } from "@otto-code/protocol/messages";
import { DiffViewer } from "@/components/diff-viewer";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { compactFont, compactUp } from "@/styles/theme";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { countDifferences } from "./diff-stats";
import { RevisionDiffBody } from "./revision-diff-body";
import { TABLE_COMPACT_SCALE, TABLE_HEADER_HEIGHT } from "./table-geometry";
import { useFileCommitDiff, useRevisionBlame } from "./use-file-history-data";

/**
 * What one revision did to this file, with a header that names *both sides* of
 * the comparison — the file's previous revision and the path it had then, versus
 * this revision and the path it has now.
 *
 * The left-hand side comes from the daemon, which resolved it by walking this
 * file's own history. It is deliberately not the commit's parent: the parent is
 * frequently a commit that never touched this file, and naming it would point
 * the reader at a revision where nothing happened.
 */

/** The revision under inspection and the file's name at that revision. */
export interface RevisionFocus {
  sha: string;
  shortSha: string;
  path: string;
}

export interface RevisionDiffProps {
  serverId: string;
  cwd: string;
  focus: RevisionFocus | null;
  ignoreWhitespace: boolean;
  notARepoLabel: string;
  onSelectBlameCommit?: (commit: GitBlameCommit) => void;
}

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 2) {
    return path;
  }
  return `…/${parts.slice(-2).join("/")}`;
}

/** The post-image line span this diff covers, for the blame gutter to annotate. */
function postImageSpan(file: ParsedDiffFile | null): { startLine: number; endLine: number } | null {
  if (!file || file.hunks.length === 0) {
    return null;
  }
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  for (const hunk of file.hunks) {
    startLine = Math.min(startLine, hunk.newStart);
    endLine = Math.max(endLine, hunk.newStart + hunk.newCount - 1);
  }
  return endLine >= startLine && startLine > 0 ? { startLine, endLine } : null;
}

export function RevisionDiff({
  serverId,
  cwd,
  focus,
  ignoreWhitespace,
  notARepoLabel,
  onSelectBlameCommit,
}: RevisionDiffProps) {
  const { t } = useTranslation();
  const diff = useFileCommitDiff({
    serverId,
    cwd,
    path: focus?.path ?? "",
    sha: focus?.sha ?? null,
    ignoreWhitespace,
    notARepoLabel,
  });
  const span = useMemo(() => postImageSpan(diff.file), [diff.file]);
  const blameByLine = useRevisionBlame({
    serverId,
    cwd,
    path: focus?.path ?? "",
    sha: focus?.sha ?? null,
    span,
    enabled: Boolean(focus) && span !== null,
    notARepoLabel,
  });
  const differences = useMemo(
    () => (diff.file ? countFileDifferences(diff.file) : countDifferences(diff.diffLines)),
    [diff.file, diff.diffLines],
  );

  if (!focus) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <Text style={styles.mutedText}>{t("gitFileHistory.selectCommit")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <RevisionHeader
        focus={focus}
        previousSha={diff.previousSha}
        previousPath={diff.previousPath}
        differences={differences}
        showCount={!diff.loading}
      />
      <DiffBody
        error={diff.error}
        loading={diff.loading}
        truncated={diff.truncated}
        file={diff.file}
        diffLines={diff.diffLines}
        blameByLine={blameByLine}
        onSelectBlameCommit={onSelectBlameCommit}
      />
    </View>
  );
}

/** Changed *blocks*, not changed lines — a five-line replacement is one edit. */
function countFileDifferences(file: ParsedDiffFile): number {
  let count = 0;
  for (const hunk of file.hunks) {
    let insideBlock = false;
    for (const line of hunk.lines) {
      const changed = line.type === "add" || line.type === "remove";
      if (changed && !insideBlock) count += 1;
      insideBlock = changed;
    }
  }
  return count;
}

function DiffBody({
  error,
  loading,
  truncated,
  file,
  diffLines,
  blameByLine,
  onSelectBlameCommit,
}: {
  error: string | null;
  loading: boolean;
  truncated: boolean;
  file: ParsedDiffFile | null;
  diffLines: DiffLine[];
  blameByLine: ReadonlyMap<number, GitBlameCommit>;
  onSelectBlameCommit?: (commit: GitBlameCommit) => void;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.mutedText}>{t("gitFileHistory.loadingDiff")}</Text>
      </View>
    );
  }
  if (file && file.hunks.length > 0) {
    return (
      <View style={styles.diffHost}>
        {truncated ? (
          <Text style={styles.truncatedNote}>{t("gitFileHistory.diffTruncated")}</Text>
        ) : null}
        <RevisionDiffBody
          file={file}
          blameByLine={blameByLine}
          onSelectBlameCommit={onSelectBlameCommit}
        />
      </View>
    );
  }
  // Fallback for a diff the daemon could not structure: no gutter is possible
  // without hunk coordinates, but the patch text is still worth showing.
  return (
    <View style={styles.diffHost}>
      {truncated ? (
        <Text style={styles.truncatedNote}>{t("gitFileHistory.diffTruncated")}</Text>
      ) : null}
      <DiffViewer
        diffLines={diffLines}
        fillAvailableHeight
        emptyLabel={t("gitFileHistory.noChangesInCommit")}
      />
    </View>
  );
}

function RevisionHeader({
  focus,
  previousSha,
  previousPath,
  differences,
  showCount,
}: {
  focus: RevisionFocus;
  previousSha: string | null;
  previousPath: string | null;
  differences: number;
  showCount: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {previousSha ? (
          <>
            <Text style={styles.headerSha} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
              {previousSha.slice(0, 8)}
            </Text>
            <Text style={styles.headerPath} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
              {shortenPath(previousPath ?? focus.path)}
            </Text>
          </>
        ) : (
          <Text style={styles.headerPath} numberOfLines={1}>
            {t("gitFileHistory.fileCreated")}
          </Text>
        )}
      </View>
      <Text style={styles.headerArrow}>→</Text>
      <View style={styles.headerSide}>
        <Text style={styles.headerSha} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
          {focus.shortSha}
        </Text>
        <Text style={styles.headerPath} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
          {shortenPath(focus.path)}
        </Text>
      </View>
      {showCount ? (
        <Text style={styles.headerCount} numberOfLines={1}>
          {t("gitFileHistory.differences", { count: differences })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    backgroundColor: theme.colors.background,
  },
  // Same height and padding as the commit table's header, so the two panes'
  // first rows line up across the splitter instead of sitting at different
  // altitudes.
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: compactUp(TABLE_HEADER_HEIGHT, TABLE_COMPACT_SCALE),
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  headerSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  headerSha: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    fontFamily: theme.fontFamily.mono,
  },
  headerPath: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontFamily: theme.fontFamily.mono,
  },
  headerArrow: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  // Pushed to the trailing edge, where a count belongs — it describes the pane,
  // it is not part of the revision pair.
  headerCount: {
    marginLeft: "auto",
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  diffHost: {
    flex: 1,
    minHeight: 0,
  },
  truncatedNote: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: compactFont(theme.fontSize.sm),
    textAlign: "center",
  },
}));
