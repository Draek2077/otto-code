import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { Check, CheckSquare, X } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { allHunkIds, applyRefineDecisions, buildRefineDiff } from "@/refine/hunks";
import { RefineHunkDecision } from "@/refine/refine-hunk-decision";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { KnowledgeReviewProposal } from "./review-session";

const ThemedCheck = withUnistyles(Check);
const ThemedCheckSquare = withUnistyles(CheckSquare);
const ThemedX = withUnistyles(X);
const SOURCE_ONLY_REVIEW_SEPARATOR = "<!-- otto:knowledge-review-evidence -->";

/**
 * The proposal takes over the article canvas for one decision. It deliberately
 * stays in Project Knowledge, where the reader selected and annotated the text.
 */
export function KnowledgeReviewProposalView({
  proposal,
  applying,
  onApply,
  onDiscard,
}: {
  proposal: KnowledgeReviewProposal;
  applying: boolean;
  onApply: (content: string) => void;
  onDiscard: () => void;
}): ReactElement {
  const { preferences } = useChangesPreferences();
  const diff = useMemo(
    () => buildRefineDiff(proposal.base, proposal.proposal),
    [proposal.base, proposal.proposal],
  );
  const [keptHunks, setKeptHunks] = useState<Set<string>>(() => allHunkIds(diff));
  useEffect(() => {
    setKeptHunks(allHunkIds(diff));
  }, [diff]);
  const proposedContent = useMemo(() => applyRefineDecisions(diff, keptHunks), [diff, keptHunks]);
  const allKept = diff.hunks.length > 0 && keptHunks.size === diff.hunks.length;
  const toggleHunk = useCallback((id: string) => {
    setKeptHunks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(
    () => setKeptHunks(allKept ? new Set() : allHunkIds(diff)),
    [allKept, diff],
  );
  const apply = useCallback(() => onApply(proposedContent), [onApply, proposedContent]);
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.copy}>
          <Text style={styles.articleTitle}>{proposal.target.title}</Text>
          <Text style={styles.title}>Review changes</Text>
          <Text style={styles.subtitle}>
            The article remains unchanged until you apply this proposal.
          </Text>
        </View>
        <Button variant="outline" size="sm" onPress={onDiscard} disabled={applying}>
          <ThemedX size={16} /> Discard
        </Button>
        <ToolbarIconButton
          label={allKept ? "Drop all changes" : "Keep all changes"}
          Icon={ThemedCheckSquare}
          onPress={toggleAll}
          selected={allKept}
          disabled={applying || diff.hunks.length === 0}
        />
        <Button size="sm" onPress={apply} loading={applying} disabled={keptHunks.size === 0}>
          <ThemedCheck size={16} /> Apply proposal
        </Button>
      </View>
      {diff.hunks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtitle}>The review instructions produced no changes.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.hunkList}>
          {diff.hunks.map((hunk, index) => (
            <RefineHunkDecision
              key={hunk.id}
              filePath={proposal.target.title}
              beforeSource={proposal.base}
              afterSource={proposal.proposal}
              hunk={hunk}
              ordinal={index + 1}
              kept={keptHunks.has(hunk.id)}
              onToggle={toggleHunk}
              presentation={preferences.presentation}
              testID="knowledge-review-hunk"
              displayLines={hunk.lines.filter(
                (line) => !line.content.includes(SOURCE_ONLY_REVIEW_SEPARATOR),
              )}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
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
  hunkList: { flexGrow: 1 },
  empty: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
}));
