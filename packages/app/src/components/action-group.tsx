import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ACTION_GROUP_CATEGORY_ORDER,
  countActionGroupCategories,
  isActiveActionMember,
  type ActionGroupCategory,
} from "@/agent-stream/action-grouping";
import { Layers } from "@/components/icons/material-icons";
import { ExpandableBadge, ToolCall } from "@/components/message";
import type { ActionGroupMemberItem } from "@/types/stream";

const SUMMARY_KEYS: Record<ActionGroupCategory, { one: string; many: string }> = {
  read: {
    one: "agentStream.actionGroup.summary.readFile",
    many: "agentStream.actionGroup.summary.readFiles",
  },
  edit: {
    one: "agentStream.actionGroup.summary.editedFile",
    many: "agentStream.actionGroup.summary.editedFiles",
  },
  write: {
    one: "agentStream.actionGroup.summary.wroteFile",
    many: "agentStream.actionGroup.summary.wroteFiles",
  },
  codeSearch: {
    one: "agentStream.actionGroup.summary.searchedCode",
    many: "agentStream.actionGroup.summary.searchedCodeMany",
  },
  webSearch: {
    one: "agentStream.actionGroup.summary.searchedWeb",
    many: "agentStream.actionGroup.summary.searchedWebMany",
  },
  fetch: {
    one: "agentStream.actionGroup.summary.fetchedPage",
    many: "agentStream.actionGroup.summary.fetchedPages",
  },
  command: {
    one: "agentStream.actionGroup.summary.ranCommand",
    many: "agentStream.actionGroup.summary.ranCommands",
  },
  browser: {
    one: "agentStream.actionGroup.summary.tookBrowserAction",
    many: "agentStream.actionGroup.summary.tookBrowserActions",
  },
  preview: {
    one: "agentStream.actionGroup.summary.tookPreviewAction",
    many: "agentStream.actionGroup.summary.tookPreviewActions",
  },
  artifact: {
    one: "agentStream.actionGroup.summary.createdArtifact",
    many: "agentStream.actionGroup.summary.createdArtifacts",
  },
  worktree: {
    one: "agentStream.actionGroup.summary.setUpWorktree",
    many: "agentStream.actionGroup.summary.setUpWorktrees",
  },
  agent: {
    one: "agentStream.actionGroup.summary.ranAgentTask",
    many: "agentStream.actionGroup.summary.ranAgentTasks",
  },
  thought: {
    one: "agentStream.actionGroup.summary.thought",
    many: "agentStream.actionGroup.summary.thoughtMany",
  },
  other: {
    one: "agentStream.actionGroup.summary.usedTool",
    many: "agentStream.actionGroup.summary.usedTools",
  },
};

// "Read 2 files, searched web, wrote file" — the phrases are stored lowercase
// and the joined summary is sentence-cased, so only the first one leads with a
// capital letter.
function buildActionGroupSummary(t: TFunction, items: ActionGroupMemberItem[]): string {
  const counts = countActionGroupCategories(items);
  const parts: string[] = [];
  for (const category of ACTION_GROUP_CATEGORY_ORDER) {
    const count = counts.get(category) ?? 0;
    if (count === 0) {
      continue;
    }
    parts.push(t(SUMMARY_KEYS[category][count === 1 ? "one" : "many"], { count }));
  }
  const summary = parts.join(", ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function isFailedMember(member: ActionGroupMemberItem): boolean {
  return member.kind === "tool_call" && member.payload.data.status === "failed";
}

interface ActionGroupMemberRowProps {
  member: ActionGroupMemberItem;
  cwd?: string;
  onOpenFilePath?: (filePath: string) => void;
}

// Mirrors how agent-stream/view.tsx maps stream items onto ToolCall rows.
// Speak bubbles and plan cards never reach here — grouping excludes them.
function ActionGroupMemberRow({ member, cwd, onOpenFilePath }: ActionGroupMemberRowProps) {
  if (member.kind === "thought") {
    return (
      <ToolCall
        toolName="thinking"
        args={member.text}
        status={member.status === "ready" ? "completed" : "executing"}
        disableExpandedSpacing
      />
    );
  }

  const { payload } = member;
  if (payload.source === "agent") {
    const data = payload.data;
    return (
      <ToolCall
        toolName={data.name}
        error={data.error}
        status={data.status}
        detail={data.detail}
        cwd={cwd}
        metadata={data.metadata}
        onOpenFilePath={onOpenFilePath}
        disableExpandedSpacing
      />
    );
  }

  const data = payload.data;
  return (
    <ToolCall
      toolName={data.toolName}
      args={data.arguments}
      result={data.result}
      status={data.status}
      onOpenFilePath={onOpenFilePath}
      disableExpandedSpacing
    />
  );
}

interface ActionGroupProps {
  items: ActionGroupMemberItem[];
  cwd?: string;
  isLastInSequence?: boolean;
  onInlineDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenFilePath?: (filePath: string) => void;
}

export const ActionGroup = memo(function ActionGroup({
  items,
  cwd,
  isLastInSequence = false,
  onInlineDetailsExpandedChange,
  onOpenFilePath,
}: ActionGroupProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setIsExpanded((previous) => !previous);
  }, []);

  useEffect(() => {
    onInlineDetailsExpandedChange?.(isExpanded);
  }, [isExpanded, onInlineDetailsExpandedChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return () => {};
    }
    return () => {
      onInlineDetailsExpandedChange(false);
    };
  }, [onInlineDetailsExpandedChange]);

  const summary = useMemo(() => buildActionGroupSummary(t, items), [t, items]);
  const isLoading = items.some(isActiveActionMember);
  const isError = items.some(isFailedMember);

  const renderDetails = useCallback(
    () => (
      <View style={styles.membersContainer}>
        {items.map((member) => (
          <ActionGroupMemberRow
            key={member.id}
            member={member}
            cwd={cwd}
            onOpenFilePath={onOpenFilePath}
          />
        ))}
      </View>
    ),
    [items, cwd, onOpenFilePath],
  );

  return (
    <ExpandableBadge
      testID="action-group-badge"
      label={summary}
      icon={Layers}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      isLoading={isLoading}
      isError={isError}
      isLastInSequence={isLastInSequence}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  membersContainer: {
    // ExpandableBadge rows bleed 13px into the chat gutter (see the
    // `container` style in message.tsx); pad the box by the same amount to
    // cancel the bleed, plus a visible inset so member rows don't sit glued
    // against the expanded group's border.
    paddingHorizontal: 13 + theme.spacing[2],
    // The container owns all spacing between member rows via `gap`; the rows
    // themselves opt out of their per-row margins (disableExpandedSpacing),
    // so padding and gap never stack.
    paddingVertical: theme.spacing[2],
    // Tighter than the spacing scale on purpose: collapsed rows should read
    // as one tight run, matching the 2px row padding of the collapsed pills.
    gap: 2,
  },
}));
