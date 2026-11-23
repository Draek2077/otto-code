import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Layers } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import { Button } from "@/components/ui/button";
import type { ActionCategory, ActionGroup, ActionMember } from "./action-groups";

// Opening a long run mounts a bounded batch. More is an explicit reader action,
// not a nested ScrollView or a second virtualizer competing with the transcript.
const MEMBER_BATCH_SIZE = 25;
const phrases: Record<ActionCategory, readonly [string, string]> = {
  read: ["read file", "read {{count}} files"],
  edit: ["edited file", "edited {{count}} files"],
  write: ["wrote file", "wrote {{count}} files"],
  search: ["searched", "searched {{count}} times"],
  command: ["ran command", "ran {{count}} commands"],
  thought: ["thought", "thought {{count}} times"],
  tool: ["used tool", "used {{count}} tools"],
};

interface Props {
  group: ActionGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
  renderMember: (member: ActionMember, isLast: boolean) => ReactNode;
  onLoadOlder?: () => boolean | Promise<boolean>;
  isLoadingOlder?: boolean;
}

export const ActionGroupView = memo(function ActionGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  renderMember,
  onLoadOlder,
  isLoadingOlder,
}: Props) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(MEMBER_BATCH_SIZE);
  const label = useMemo(() => {
    const parts = (Object.keys(phrases) as ActionCategory[]).flatMap((key) => {
      const count = group.counts[key] ?? 0;
      return count
        ? [
            t(`otto.actionGroups.${key}.${count === 1 ? "one" : "other"}`, {
              count,
              defaultValue: phrases[key][count === 1 ? 0 : 1],
            }),
          ]
        : [];
    });
    const text = parts.join(", ");
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
  }, [group.counts, t]);
  const toggle = useCallback(() => {
    if (expanded) setVisibleCount(MEMBER_BATCH_SIZE);
    onExpandedChange(group.id, !expanded);
  }, [expanded, group.id, onExpandedChange]);
  const showMore = useCallback(() => setVisibleCount((count) => count + MEMBER_BATCH_SIZE), []);
  const loadOlder = useCallback(() => {
    void onLoadOlder?.();
  }, [onLoadOlder]);
  const details = useCallback(
    () => (
      <View style={styles.members} testID="action-group-members">
        {group.members.slice(0, visibleCount).map((member, index) => (
          <View key={member.id}>
            {renderMember(member, index === Math.min(visibleCount, group.members.length) - 1)}
          </View>
        ))}
        {visibleCount < group.members.length ? (
          <Button variant="ghost" size="sm" onPress={showMore}>
            {t("otto.actionGroups.showMore", {
              defaultValue: "Show {{count}} more actions",
              count: Math.min(MEMBER_BATCH_SIZE, group.members.length - visibleCount),
            })}
          </Button>
        ) : null}
      </View>
    ),
    [group.members, renderMember, showMore, t, visibleCount],
  );
  return (
    <View>
      {onLoadOlder ? (
        <Button variant="ghost" size="sm" disabled={isLoadingOlder} onPress={loadOlder}>
          {t("otto.actionGroups.loadOlder", { defaultValue: "Load older messages" })}
        </Button>
      ) : null}
      <ExpandableBadge
        testID="action-group-badge"
        icon={Layers}
        label={label}
        secondaryLabel={
          group.failedCount
            ? t("otto.actionGroups.failed", {
                defaultValue: "{{count}} failed",
                count: group.failedCount,
              })
            : undefined
        }
        isError={group.failedCount > 0}
        isExpanded={expanded}
        onToggle={toggle}
        isLastInSequence={isLastInSequence}
        renderDetails={details}
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  members: { paddingLeft: theme.spacing[4], paddingRight: theme.spacing[2] },
}));
