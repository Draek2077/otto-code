import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { normalizePersonalityRoles } from "@otto-code/protocol/agent-personalities";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/provider-selection/role-labels";

/**
 * What happens to a personality's accrued lessons when the personality is
 * deleted. This sheet exists because the alternative — deleting the roster entry
 * and silently dropping everything it had learned — destroys the only part of a
 * personality that took real work to produce.
 *
 * So the delete asks a three-way question rather than a yes/no one: hand the
 * lessons to someone else, discard them deliberately, or back out. Transfer is
 * the default and the recommended answer, which is why it is the primary action
 * and discarding is the destructive secondary.
 *
 * Same-role personalities come first in the destination list, because that is
 * overwhelmingly the intent: you are replacing a Coder with another Coder, and
 * its lessons are about coding here.
 */

export type MemoryTransferChoice =
  | { kind: "transfer"; toPersonalityId: string }
  | { kind: "delete" };

interface PersonalityMemoryTransferSheetProps {
  visible: boolean;
  /** The personality being deleted. */
  personality: AgentPersonality;
  /** How many lessons are at stake — named, so the decision is informed. */
  lessonCount: number;
  /** The rest of the roster, as possible destinations. */
  candidates: readonly AgentPersonality[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (choice: MemoryTransferChoice) => void;
}

export function PersonalityMemoryTransferSheet({
  visible,
  personality,
  lessonCount,
  candidates,
  busy,
  error,
  onCancel,
  onConfirm,
}: PersonalityMemoryTransferSheetProps): ReactElement {
  const { t } = useTranslation();
  const ordered = useMemo(
    () => orderBySharedRole(personality, candidates),
    [personality, candidates],
  );
  // Pre-selecting the top candidate makes the recommended path a single press,
  // and there is no meaningful "no destination" state to represent: the other
  // outcome is the explicit Discard button.
  const [selectedId, setSelectedId] = useState<string | null>(ordered[0]?.personality.id ?? null);

  const handleTransfer = useCallback(() => {
    if (!selectedId) return;
    onConfirm({ kind: "transfer", toPersonalityId: selectedId });
  }, [onConfirm, selectedId]);

  const handleDiscard = useCallback(() => onConfirm({ kind: "delete" }), [onConfirm]);

  const header = useMemo(
    () => ({
      title: t("contextManagement.memory.transfer.title", { name: personality.name }),
      subtitle:
        lessonCount === 1
          ? t("contextManagement.memory.transfer.subtitleOne")
          : t("contextManagement.memory.transfer.subtitleMany", { count: lessonCount }),
    }),
    [t, lessonCount, personality.name],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={onCancel} disabled={busy} testID="memory-transfer-cancel">
          {t("common.actions.cancel")}
        </Button>
        <View style={styles.footerSpacer} />
        <Button
          variant="destructive"
          onPress={handleDiscard}
          disabled={busy}
          testID="memory-transfer-discard"
        >
          {t("contextManagement.memory.transfer.discard")}
        </Button>
        <Button
          variant="default"
          onPress={handleTransfer}
          disabled={busy || !selectedId}
          testID="memory-transfer-confirm"
        >
          {t("contextManagement.memory.transfer.confirm")}
        </Button>
      </View>
    ),
    [t, busy, handleDiscard, handleTransfer, onCancel, selectedId],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onCancel}
      footer={footer}
      desktopMaxWidth={520}
      testID="personality-memory-transfer-sheet"
    >
      {ordered.length === 0 ? (
        <Text style={styles.body}>
          {t("contextManagement.memory.transfer.noCandidates", { name: personality.name })}
        </Text>
      ) : (
        <>
          <Text style={styles.body}>{t("contextManagement.memory.transfer.giveThemTo")}</Text>
          {ordered.map(({ personality: candidate, sharesRole }) => (
            <DestinationRow
              key={candidate.id}
              personality={candidate}
              sharesRole={sharesRole}
              selected={candidate.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </>
      )}
      {error ? (
        <Text style={styles.error} testID="memory-transfer-error">
          {error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

interface DestinationRowProps {
  personality: AgentPersonality;
  sharesRole: boolean;
  selected: boolean;
  onSelect: (personalityId: string) => void;
}

function DestinationRow({
  personality,
  sharesRole,
  selected,
  onSelect,
}: DestinationRowProps): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(personality.id), [onSelect, personality.id]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const roleLabels = useMemo(
    () =>
      normalizePersonalityRoles(personality.roles)
        .map((role) => ROLE_LABELS[role])
        .join(", "),
    [personality.roles],
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={selected ? styles.rowSelected : styles.row}
      testID={`memory-transfer-destination-${personality.id}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{personality.name}</Text>
        {roleLabels ? <Text style={styles.rowMeta}>{roleLabels}</Text> : null}
      </View>
      {/* The shared-role hint is why this row is near the top; saying so beats
          silently reordering and hoping the user infers the rule. */}
      {sharesRole ? (
        <Text style={styles.rowHint}>{t("contextManagement.memory.transfer.sameRole")}</Text>
      ) : null}
    </Pressable>
  );
}

interface OrderedCandidate {
  personality: AgentPersonality;
  sharesRole: boolean;
}

/**
 * Same-role candidates first, roster order within each group. Pure reordering:
 * nothing is excluded, because a user moving a Coder's lessons onto an
 * Orchestrator may well know something the role tags do not.
 */
function orderBySharedRole(
  source: AgentPersonality,
  candidates: readonly AgentPersonality[],
): OrderedCandidate[] {
  const sourceRoles = new Set(normalizePersonalityRoles(source.roles));
  const scored = candidates
    .filter((candidate) => candidate.id !== source.id)
    .map((candidate) => ({
      personality: candidate,
      sharesRole: normalizePersonalityRoles(candidate.roles).some((role) => sourceRoles.has(role)),
    }));
  return [
    ...scored.filter((entry) => entry.sharesRole),
    ...scored.filter((entry) => !entry.sharesRole),
  ];
}

const styles = StyleSheet.create((theme) => {
  const rowBase = {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
  } as const;
  return {
    body: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
    },
    row: { ...rowBase, borderColor: theme.colors.border },
    rowSelected: { ...rowBase, borderColor: theme.colors.accent },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[1],
    },
    rowName: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    rowMeta: {
      color: theme.colors.mutedForeground,
      fontSize: theme.fontSize.xs,
    },
    rowHint: {
      color: theme.colors.accent,
      fontSize: theme.fontSize.xs,
      flexShrink: 0,
    },
    error: {
      color: theme.colors.statusDanger,
      fontSize: theme.fontSize.sm,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    footerSpacer: {
      flex: 1,
      minWidth: 0,
    },
  };
});
