import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { DiffViewer } from "@/components/diff-viewer";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import type { RefineDiff } from "@/refine/hunks";
import { RefineHunkDecision } from "@/refine/refine-hunk-decision";
import { StyleSheet } from "react-native-unistyles";
import type { KnowledgeReviewProposal } from "./review-session";

const SOURCE_ONLY_REVIEW_SEPARATOR = "<!-- otto:knowledge-review-evidence -->";

/**
 * The proposal takes over the article canvas for one decision. It deliberately
 * stays in Project Knowledge, where the reader selected and annotated the text.
 */
export function KnowledgeReviewProposalView({
  proposal,
  diff,
  keptHunks,
  onToggleHunk,
  wrap,
}: {
  proposal: KnowledgeReviewProposal;
  diff: RefineDiff;
  keptHunks: ReadonlySet<string>;
  onToggleHunk: (id: string) => void;
  wrap: boolean;
}): ReactElement {
  const { preferences } = useChangesPreferences();
  const sections = useMemo(() => buildReviewSections(diff), [diff]);
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={styles.articleTitle}>{proposal.target.title}</Text>
        <Text style={styles.title}>Review changes</Text>
        <Text style={styles.subtitle}>
          The article remains unchanged until you apply the kept changes.
        </Text>
      </View>
      {diff.hunks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtitle}>The review instructions produced no changes.</Text>
        </View>
      ) : (
        <View style={styles.hunkList}>
          {sections.map((section) =>
            section.kind === "context" ? (
              <ReviewContext
                key={section.id}
                lines={section.lines}
                proposal={proposal}
                presentation={preferences.presentation}
                wrap={wrap}
              />
            ) : (
              <RefineHunkDecision
                key={section.hunk.id}
                filePath={proposal.target.title}
                beforeSource={proposal.base}
                afterSource={proposal.proposal}
                hunk={section.hunk}
                ordinal={section.ordinal}
                kept={keptHunks.has(section.hunk.id)}
                onToggle={onToggleHunk}
                presentation={preferences.presentation}
                wrap={wrap}
                testID="knowledge-review-hunk"
                displayLines={visibleLines(section.hunk.lines)}
              />
            ),
          )}
        </View>
      )}
    </View>
  );
}

function ReviewContext({
  lines,
  proposal,
  presentation,
  wrap,
}: {
  lines: RefineDiff["lines"];
  proposal: KnowledgeReviewProposal;
  presentation: ReturnType<typeof useChangesPreferences>["preferences"]["presentation"];
  wrap: boolean;
}): ReactElement | null {
  const visible = useMemo(() => visibleLines(lines), [lines]);
  const document = useMemo(
    () => ({
      source: "proposal" as const,
      filePath: proposal.target.title,
      lines: visible,
      beforeSource: proposal.base,
      afterSource: proposal.proposal,
    }),
    [proposal.base, proposal.proposal, proposal.target.title, visible],
  );
  if (visible.length === 0) return null;
  return (
    <DiffViewer
      diffLines={visible}
      document={document}
      presentation={presentation}
      frame="none"
      embedded
      wrap={wrap}
    />
  );
}

type ReviewSection =
  | { kind: "context"; id: string; lines: RefineDiff["lines"] }
  | { kind: "hunk"; hunk: RefineDiff["hunks"][number]; ordinal: number };

/**
 * The hunk toggle owns only changed ranges. Context belongs to the document,
 * so we keep it in the reading flow as a plain diff segment between controls.
 */
function buildReviewSections(diff: RefineDiff): ReviewSection[] {
  const sections: ReviewSection[] = [];
  let cursor = 0;
  for (const [index, hunk] of diff.hunks.entries()) {
    if (cursor < hunk.displayStart) {
      sections.push({
        kind: "context",
        id: `context-${cursor}`,
        lines: diff.lines.slice(cursor, hunk.displayStart),
      });
    }
    sections.push({ kind: "hunk", hunk, ordinal: index + 1 });
    cursor = hunk.displayEnd + 1;
  }
  if (cursor < diff.lines.length) {
    sections.push({ kind: "context", id: `context-${cursor}`, lines: diff.lines.slice(cursor) });
  }
  return sections;
}

function visibleLines(lines: RefineDiff["lines"]): RefineDiff["lines"] {
  return lines.filter((line) => !line.content.includes(SOURCE_ONLY_REVIEW_SEPARATOR));
}

const styles = StyleSheet.create((theme) => ({
  root: { width: "100%" },
  heading: {
    gap: 2,
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
  },
  articleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.xs },
  hunkList: { width: "100%" },
  empty: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
}));
