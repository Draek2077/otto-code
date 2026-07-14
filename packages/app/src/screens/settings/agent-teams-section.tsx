// Agent Teams editor — named, per-host groupings of agent personalities that
// act as switchable operating templates: which personalities are on deck plus
// a shared team prompt stacked ahead of each member's personality prompt at
// spawn. Lives in the host settings "Agents" section, directly under the
// Agent Personalities editor. See docs/agent-teams.md.
//
// i18n: copy here is English-only pending a translation pass (build-first,
// translate-last). Do not add keys to the locale resources for this surface yet.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentPersonality, AgentTeam, PersonalityRole } from "@otto-code/protocol/messages";
import {
  checkPersonalityAvailability,
  normalizePersonalityRoles,
} from "@otto-code/protocol/agent-personalities";
import { pruneTeamMemberIds, teamRoleUnion } from "@otto-code/protocol/agent-teams";
import { DEFAULT_AGENT_TEAMS } from "@otto-code/protocol/default-personalities";
import { Check, Pencil, Plus, Trash2 } from "@/components/icons/material-icons";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { Button } from "@/components/ui/button";
import { ColorWheelPicker } from "@/components/ui/color-wheel-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SettingsSection } from "@/screens/settings/settings-section";
import { ROLE_LABELS } from "@/provider-selection/role-labels";
import { useIsExtraCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

/**
 * The single detection point for the agent teams capability.
 * COMPAT(agentTeams): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
 */
export function useAgentTeamsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentTeams === true,
  );
}

const DEFAULT_TEAM_COLOR = "#4ec4ff";

// Team names are human labels (they appear in the switcher dropdown and on
// cards), so unlike personality handles they allow spaces — but stay short and
// free of structural characters so a name renders cleanly everywhere.
const MAX_TEAM_NAME_LENGTH = 30;

function sanitizeTeamName(value: string): string {
  return value.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, MAX_TEAM_NAME_LENGTH);
}

// Same guard as the personality spinner colors: hand-typed text must be a real
// hex color before save; the color wheel always emits valid values.
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim());
}

function generateTeamId(): string {
  return `team_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

interface TeamDraft {
  name: string;
  color: string;
  teamPrompt: string;
  memberIds: string[];
}

function teamToDraft(team: AgentTeam): TeamDraft {
  return {
    name: team.name,
    color: team.avatar?.color ?? DEFAULT_TEAM_COLOR,
    teamPrompt: team.teamPrompt ?? "",
    memberIds: [...(team.memberIds ?? [])],
  };
}

function draftToTeam(
  draft: TeamDraft,
  id: string,
  personalities: readonly AgentPersonality[],
): AgentTeam {
  const team: AgentTeam = {
    id,
    name: draft.name.trim(),
    avatar: { color: draft.color.trim() },
    // Save-time prune: dangling member ids (deleted personalities) drop here,
    // never eagerly on delete.
    memberIds: pruneTeamMemberIds(draft.memberIds, personalities),
  };
  const prompt = draft.teamPrompt.trim();
  if (prompt) {
    team.teamPrompt = prompt;
  }
  return team;
}

function emptyDraft(): TeamDraft {
  return {
    name: "",
    color: DEFAULT_TEAM_COLOR,
    teamPrompt: "",
    memberIds: [],
  };
}

// Themed icons (module scope so they are stable props).
const ThemedPlus = withUnistyles(Plus);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const ThemedCheck = withUnistyles(Check);

const iconMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const iconForegroundMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const iconDestructiveMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
  size: theme.iconSize.sm,
});
const checkAccentMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

const FLEX_1 = { flex: 1 } as const;

// Canonical icon-only affordance — hover chrome + tooltip (mirrors the
// personalities editor / file-view-mode-bar).
type ThemedIcon = typeof ThemedPlus;

interface IconButtonProps {
  Icon: ThemedIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
}

function IconButton({
  Icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
  testID,
}: IconButtonProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const active = hovered && !disabled;
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.iconButton,
      (active || pressed) && styles.iconButtonHovered,
      disabled && styles.iconButtonDisabled,
    ],
    [active, disabled],
  );
  let mapping = iconMutedMapping;
  if (destructive) {
    mapping = iconDestructiveMapping;
  } else if (active) {
    mapping = iconForegroundMapping;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={triggerStyle}
        testID={testID}
      >
        <Icon uniProps={mapping} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AgentTeamsSection({ serverId }: { serverId: string }): ReactElement | null {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useAgentTeamsFeature(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { entries } = useProvidersSnapshot(serverId, { enabled: isConnected && hasFeature });

  const [editing, setEditing] = useState<{ id: string | null; draft: TeamDraft } | null>(null);

  const teams = useMemo(() => config?.agentTeams?.teams ?? [], [config]);
  const activeTeamId = config?.agentTeams?.activeTeamId ?? null;
  const personalities = useMemo(() => config?.agentPersonalities?.personalities ?? [], [config]);
  const providerEntries = useMemo(() => entries ?? [], [entries]);

  const saveTeams = useCallback(
    async (next: AgentTeam[], options?: { clearActive?: boolean }) => {
      await patchConfig({
        agentTeams: {
          teams: next,
          ...(options?.clearActive ? { activeTeamId: null } : {}),
        },
      });
    },
    [patchConfig],
  );

  const handleAdd = useCallback(() => {
    setEditing({ id: null, draft: emptyDraft() });
  }, []);

  const handleEdit = useCallback(
    (id: string) => {
      const team = teams.find((entry) => entry.id === id);
      if (!team) return;
      setEditing({ id, draft: teamToDraft(team) });
    },
    [teams],
  );

  const handleClose = useCallback(() => setEditing(null), []);

  const handleSave = useCallback(
    async (draft: TeamDraft) => {
      if (!editing) return;
      const id = editing.id ?? generateTeamId();
      const team = draftToTeam(draft, id, personalities);
      // A team can vanish from the config mid-edit (deleted from another
      // client); mapping by id would silently drop the save, so append
      // (recreate) it instead.
      const stillExists = editing.id !== null && teams.some((entry) => entry.id === editing.id);
      const next = stillExists
        ? teams.map((entry) => (entry.id === editing.id ? team : entry))
        : [...teams, team];
      try {
        await saveTeams(next);
        setEditing(null);
      } catch (error) {
        Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
      }
    },
    [editing, teams, personalities, saveTeams],
  );

  // Team names are unique per host (case-insensitive) — they are what the
  // switcher and cards display; a collision blocks save with an inline error.
  const takenNames = useMemo(
    () =>
      teams
        .filter((entry) => entry.id !== editing?.id)
        .map((entry) => entry.name.trim().toLowerCase()),
    [teams, editing],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const team = teams.find((entry) => entry.id === id);
      if (!team) return;
      void (async () => {
        const isActive = id === activeTeamId;
        const confirmed = await confirmDialog({
          title: "Delete team",
          message: isActive
            ? `Delete "${team.name}"? It is the active team; the host reverts to no active team. Personalities are not deleted.`
            : `Delete "${team.name}"? Personalities are not deleted.`,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          destructive: true,
        });
        if (!confirmed) return;
        try {
          // Deleting the active team clears the active id in the same patch —
          // never leave a dangling reference (the daemon heals it anyway).
          await saveTeams(
            teams.filter((entry) => entry.id !== id),
            { clearActive: isActive },
          );
        } catch (error) {
          Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [teams, activeTeamId, saveTeams],
  );

  // Restore re-adds only builtins whose stable `team_builtin_*` id is missing,
  // so a kept/renamed starter team is never duplicated. Restored members that
  // reference deleted starter personalities are tolerated and pruned on the
  // team's next save, per the dangling-member rule.
  const missingDefaultsCount = useMemo(() => {
    const existingIds = new Set(teams.map((entry) => entry.id));
    return DEFAULT_AGENT_TEAMS.filter((entry) => !existingIds.has(entry.id)).length;
  }, [teams]);

  const handleRestoreDefaults = useCallback(async () => {
    const existingIds = new Set(teams.map((entry) => entry.id));
    const missing = DEFAULT_AGENT_TEAMS.filter((entry) => !existingIds.has(entry.id));
    if (missing.length === 0) return;
    try {
      await saveTeams([...teams, ...missing]);
    } catch (error) {
      Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
    }
  }, [teams, saveTeams]);

  const restoreDisabled = !isConnected || !config || missingDefaultsCount === 0;

  const addButton = useMemo(
    () => (
      <IconButton
        Icon={ThemedPlus}
        label="Add team"
        onPress={handleAdd}
        disabled={!isConnected || !config || personalities.length === 0}
        testID="agent-teams-add-button"
      />
    ),
    [handleAdd, isConnected, config, personalities.length],
  );

  if (!isConnected || !hasFeature) {
    return null;
  }

  return (
    <>
      <SettingsSection title="Agent teams" trailing={addButton} testID="agent-teams-section">
        <View style={settingsStyles.card} testID="agent-teams-card">
          {teams.length > 0 ? (
            teams.map((team, index) => (
              <TeamRow
                key={team.id}
                team={team}
                personalities={personalities}
                entries={providerEntries}
                isFirst={index === 0}
                isActive={team.id === activeTeamId}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {personalities.length === 0
                  ? "Teams group personalities into switchable operating templates. Add personalities first, then build a team from them."
                  : "No teams yet. Group personalities into a team with a shared team prompt, then switch the active team from the main menu."}
              </Text>
              {personalities.length > 0 ? (
                <Button
                  variant="secondary"
                  onPress={handleRestoreDefaults}
                  disabled={restoreDisabled}
                  style={styles.restoreButton}
                  testID="agent-teams-restore-button"
                >
                  Add starter team
                </Button>
              ) : null}
            </View>
          )}
        </View>
        {teams.length > 0 && missingDefaultsCount > 0 ? (
          <View style={styles.restoreFooter}>
            <Button
              variant="ghost"
              onPress={handleRestoreDefaults}
              disabled={restoreDisabled}
              testID="agent-teams-restore-button"
            >
              Restore starter team
            </Button>
          </View>
        ) : null}
      </SettingsSection>

      {editing ? (
        <TeamEditModal
          title={editing.id ? "Edit team" : "Add team"}
          initialDraft={editing.draft}
          personalities={personalities}
          entries={providerEntries}
          takenNames={takenNames}
          onClose={handleClose}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

const MAX_MEMBER_ICONS = 8;
const MEMBER_ICON_SIZE = 16;

interface TeamRowProps {
  team: AgentTeam;
  personalities: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
  isFirst: boolean;
  isActive: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

// Member identities — one provider icon per member, filled with that member's
// spinner gradient (same glyph the roster and pickers use). Overflow collapses
// to a +N count.
function MemberIcons({
  team,
  personalities,
  entries,
}: {
  team: AgentTeam;
  personalities: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
}): ReactElement | null {
  const members = useMemo(() => {
    const byId = new Map(personalities.map((entry) => [entry.id, entry]));
    const resolved = (team.memberIds ?? []).flatMap((memberId) => {
      const personality = byId.get(memberId);
      return personality ? [personality] : [];
    });
    return {
      shown: resolved.slice(0, MAX_MEMBER_ICONS),
      overflow: Math.max(0, resolved.length - MAX_MEMBER_ICONS),
    };
  }, [team, personalities]);
  if (members.shown.length === 0) {
    return null;
  }
  return (
    <View style={styles.memberIcons}>
      {members.shown.map((member) => {
        const entry = entries.find((candidate) => candidate.provider === member.provider);
        const providerLabel = entry?.label ?? member.provider;
        const modelLabel =
          entry?.models?.find((model) => model.id === member.model)?.label ?? member.model;
        return (
          <Tooltip key={member.id} delayDuration={300}>
            <TooltipTrigger accessibilityRole="image" accessibilityLabel={member.name}>
              <PersonalityProviderIcon
                provider={member.provider}
                size={MEMBER_ICON_SIZE}
                glowA={member.spinner?.glowA}
                glowB={member.spinner?.glowB}
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.memberTooltipName}>{member.name}</Text>
              <Text style={styles.memberTooltipMeta}>
                {providerLabel} · {modelLabel}
              </Text>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {members.overflow > 0 ? (
        <Text style={styles.memberDotOverflow}>+{members.overflow}</Text>
      ) : null}
    </View>
  );
}

function RolePills({ roles }: { roles: readonly PersonalityRole[] }): ReactElement | null {
  if (roles.length === 0) {
    return null;
  }
  return (
    <View style={styles.rolePills}>
      {roles.map((role) => (
        <View key={role} style={styles.rolePill}>
          <Text style={styles.rolePillText}>{ROLE_LABELS[role]}</Text>
        </View>
      ))}
    </View>
  );
}

function formatMemberCount(team: AgentTeam, personalities: readonly AgentPersonality[]): string {
  const known = new Set(personalities.map((entry) => entry.id));
  const count = (team.memberIds ?? []).filter((memberId) => known.has(memberId)).length;
  return count === 1 ? "1 member" : `${count} members`;
}

function TeamRow({
  team,
  personalities,
  entries,
  isFirst,
  isActive,
  onEdit,
  onRemove,
}: TeamRowProps): ReactElement {
  const handleEdit = useCallback(() => onEdit(team.id), [onEdit, team.id]);
  const handleRemove = useCallback(() => onRemove(team.id), [onRemove, team.id]);

  const roles = useMemo(() => teamRoleUnion(team, personalities), [team, personalities]);
  const isStacked = useIsExtraCompactFormFactor();

  const avatarStyle = useMemo(
    () => [styles.teamAvatar, { backgroundColor: team.avatar?.color ?? "#888888" }],
    [team.avatar?.color],
  );
  const stackedRowStyle = useMemo(
    () => [styles.stackedRow, !isFirst && styles.rowBorder],
    [isFirst],
  );
  const wideRowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && styles.rowBorder, styles.wideRow],
    [isFirst],
  );

  const avatar = <View style={avatarStyle} />;

  const activeBadge = isActive ? (
    <View style={styles.activeBadge} testID={`agent-team-active-badge-${team.id}`}>
      <Text style={styles.activeBadgeText}>Active</Text>
    </View>
  ) : null;

  const actions = (
    <View style={styles.rowActions}>
      <IconButton
        Icon={ThemedPencil}
        label="Edit team"
        onPress={handleEdit}
        testID={`agent-team-edit-${team.id}`}
      />
      <IconButton
        Icon={ThemedTrash}
        label="Delete team"
        destructive
        onPress={handleRemove}
        testID={`agent-team-remove-${team.id}`}
      />
    </View>
  );

  if (isStacked) {
    return (
      <View style={stackedRowStyle} testID={`agent-team-row-${team.id}`}>
        <View style={styles.stackedInfo}>
          <View style={styles.stackedNameRow}>
            {avatar}
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {team.name}
            </Text>
            {activeBadge}
          </View>
          <Text style={styles.stackedMeta}>{formatMemberCount(team, personalities)}</Text>
          <MemberIcons team={team} personalities={personalities} entries={entries} />
          <RolePills roles={roles} />
        </View>
        {actions}
      </View>
    );
  }

  return (
    <View style={wideRowStyle} testID={`agent-team-row-${team.id}`}>
      {avatar}
      <View style={INFO_COLUMN_STYLE}>
        <View style={styles.nameRow}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {team.name}
          </Text>
          {activeBadge}
        </View>
        <View style={styles.metaRow}>
          <Text style={META_COUNT_STYLE}>{formatMemberCount(team, personalities)}</Text>
          <MemberIcons team={team} personalities={personalities} entries={entries} />
        </View>
        <RolePills roles={roles} />
      </View>
      {actions}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Editor modal
// ---------------------------------------------------------------------------

interface TeamEditModalProps {
  title: string;
  initialDraft: TeamDraft;
  personalities: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
  // Lowercased trimmed names of every other team; the draft must not collide.
  takenNames: readonly string[];
  onClose: () => void;
  onSave: (draft: TeamDraft) => Promise<void>;
}

function TeamEditModal({
  title,
  initialDraft,
  personalities,
  entries,
  takenNames,
  onClose,
  onSave,
}: TeamEditModalProps): ReactElement {
  const [draft, setDraft] = useState<TeamDraft>(initialDraft);
  const [isSaving, setIsSaving] = useState(false);

  const header = useMemo(() => ({ title }), [title]);

  const setName = useCallback((value: string) => {
    setDraft((current) => ({ ...current, name: sanitizeTeamName(value) }));
  }, []);
  const setColor = useCallback((value: string) => {
    setDraft((current) => ({ ...current, color: value }));
  }, []);
  const setPrompt = useCallback((value: string) => {
    setDraft((current) => ({ ...current, teamPrompt: value }));
  }, []);

  const toggleMember = useCallback((personalityId: string) => {
    setDraft((current) => {
      const has = current.memberIds.includes(personalityId);
      return {
        ...current,
        memberIds: has
          ? current.memberIds.filter((entry) => entry !== personalityId)
          : [...current.memberIds, personalityId],
      };
    });
  }, []);

  const nameCollides = takenNames.includes(draft.name.trim().toLowerCase());
  const colorValid = isHexColor(draft.color);
  // Members must resolve against the CURRENT roster — a draft carrying only
  // dangling ids (personalities deleted mid-edit) must not save as "empty".
  const knownIds = useMemo(() => new Set(personalities.map((entry) => entry.id)), [personalities]);
  const resolvedMemberCount = draft.memberIds.filter((memberId) => knownIds.has(memberId)).length;
  const canSave =
    draft.name.trim().length > 0 && !nameCollides && colorValid && resolvedMemberCount >= 1;

  const handleSave = useCallback(() => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    // The parent unmounts this modal on success and surfaces save errors itself;
    // the lock holds until the round-trip settles so a double-click cannot mint
    // a duplicate team.
    void (async () => {
      try {
        await onSave(draft);
      } finally {
        setIsSaving(false);
      }
    })();
  }, [canSave, draft, isSaving, onSave]);

  // Cancel/backdrop-close confirms before discarding a dirty draft (exact
  // stringify dirty check — the draft is plain JSON-safe data).
  const handleClose = useCallback(() => {
    if (JSON.stringify(draft) === JSON.stringify(initialDraft)) {
      onClose();
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Discard changes?",
        message: "This team has unsaved changes.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (confirmed) onClose();
    })();
  }, [draft, initialDraft, onClose]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={handleClose}
      webScrollbar
      testID="agent-team-edit-modal"
    >
      <View style={styles.editorBody}>
        <FieldLabel label="Name" />
        <TextInput
          value={draft.name}
          onChangeText={setName}
          placeholder="e.g. Shipping crew"
          placeholderTextColor={styles.placeholder.color}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_TEAM_NAME_LENGTH}
          style={styles.textInput}
          testID="agent-team-name-input"
        />
        {nameCollides ? (
          <Text style={styles.fieldError} testID="agent-team-name-collision">
            Another team already uses this name.
          </Text>
        ) : null}

        <AvatarColorField color={draft.color} onChange={setColor} />

        <FieldLabel label="Team prompt" />
        <TextInput
          value={draft.teamPrompt}
          onChangeText={setPrompt}
          placeholder="How this team works together (optional)."
          placeholderTextColor={styles.placeholder.color}
          multiline
          style={styles.textArea}
          testID="agent-team-prompt-input"
        />
        <Text style={styles.fieldHint}>
          Added before each member&apos;s personality prompt when this team is active.
        </Text>

        <MembersField
          personalities={personalities}
          entries={entries}
          memberIds={draft.memberIds}
          onToggle={toggleMember}
        />
        {resolvedMemberCount === 0 ? (
          <Text style={styles.fieldError} testID="agent-team-members-required">
            Pick at least one member.
          </Text>
        ) : null}

        <View style={styles.editorActions}>
          <Button variant="secondary" size="sm" style={FLEX_1} onPress={handleClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            style={FLEX_1}
            onPress={handleSave}
            disabled={!canSave || isSaving}
            testID="agent-team-save-button"
          >
            Save
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-fields
// ---------------------------------------------------------------------------

function FieldLabel({ label }: { label: string }): ReactElement {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

const AVATAR_WHEEL_SIZE = 120;

function AvatarColorField({
  color,
  onChange,
}: {
  color: string;
  onChange: (next: string) => void;
}): ReactElement {
  const valid = isHexColor(color);
  const swatchStyle = useMemo(
    () => [styles.avatarSwatch, valid && { backgroundColor: color }],
    [valid, color],
  );
  const inputStyle = useMemo(
    () => [styles.colorTextInput, !valid && styles.colorTextInputInvalid],
    [valid],
  );
  return (
    <View style={styles.avatarField}>
      <View style={styles.avatarHeader}>
        <FieldLabel label="Team color" />
        <View style={swatchStyle} />
      </View>
      <View style={styles.avatarControls}>
        <ColorWheelPicker
          value={color}
          onChange={onChange}
          size={AVATAR_WHEEL_SIZE}
          testID="agent-team-color-wheel"
        />
        <TextInput
          value={color}
          onChangeText={onChange}
          placeholder={DEFAULT_TEAM_COLOR}
          placeholderTextColor={styles.placeholder.color}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={inputStyle}
          accessibilityLabel="Team color"
          testID="agent-team-color-input"
        />
      </View>
    </View>
  );
}

interface MembersFieldProps {
  personalities: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
  memberIds: readonly string[];
  onToggle: (personalityId: string) => void;
}

function MembersField({
  personalities,
  entries,
  memberIds,
  onToggle,
}: MembersFieldProps): ReactElement {
  return (
    <View style={styles.membersField}>
      <FieldLabel label="Members" />
      <View style={styles.membersList}>
        {personalities.map((personality) => (
          <MemberRow
            key={personality.id}
            personality={personality}
            entries={entries}
            checked={memberIds.includes(personality.id)}
            onToggle={onToggle}
          />
        ))}
        {personalities.length === 0 ? (
          <Text style={styles.emptyText}>No personalities on this host yet.</Text>
        ) : null}
      </View>
    </View>
  );
}

interface MemberRowProps {
  personality: AgentPersonality;
  entries: readonly ProviderSnapshotEntry[];
  checked: boolean;
  onToggle: (personalityId: string) => void;
}

function MemberRow({ personality, entries, checked, onToggle }: MemberRowProps): ReactElement {
  const handlePress = useCallback(() => onToggle(personality.id), [onToggle, personality.id]);

  // Checking is never blocked by unavailability — a team can include a
  // currently-offline member; it grays in pickers as usual. Availability is
  // shown here purely as information.
  const availability = useMemo(() => {
    const entry = entries.find((candidate) => candidate.provider === personality.provider);
    return checkPersonalityAvailability(personality, {
      providerStatus: entry?.status,
      providerEnabled: entry?.enabled,
      modelIds: entry?.models?.map((model) => model.id),
      modeIds: entry?.modes?.map((mode) => mode.id),
    });
  }, [entries, personality]);

  const roles = useMemo(() => normalizePersonalityRoles(personality.roles), [personality]);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.memberRow,
      pressed && styles.memberRowPressed,
    ],
    [],
  );
  const a11yState = useMemo(() => ({ checked }), [checked]);
  const checkboxStyle = useMemo(
    () => [styles.memberCheckbox, checked && styles.memberCheckboxChecked],
    [checked],
  );
  const infoStyle = useMemo(
    () => [styles.memberInfo, !availability.available && styles.dimmed],
    [availability.available],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="checkbox"
      accessibilityState={a11yState}
      accessibilityLabel={personality.name}
      testID={`agent-team-member-${personality.id}`}
    >
      <View style={checkboxStyle}>
        {checked ? <ThemedCheck size={12} uniProps={checkAccentMapping} /> : null}
      </View>
      <PersonalityProviderIcon
        provider={personality.provider}
        size={MEMBER_ICON_SIZE}
        glowA={personality.spinner?.glowA}
        glowB={personality.spinner?.glowB}
      />
      <View style={infoStyle}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {roles.map((role) => ROLE_LABELS[role]).join(", ") || "No roles"}
        </Text>
        {!availability.available ? (
          <Text style={styles.unavailableText} numberOfLines={2}>
            Unavailable — {availability.reason}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  wideRow: {
    gap: theme.spacing[3],
  },
  stackedRow: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  stackedInfo: {
    alignItems: "center",
    gap: 6,
  },
  stackedNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stackedMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs + 2,
    textAlign: "center",
  },
  rowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Neutralizes rowHint's own marginTop so the member-count text sits on the
  // same centerline as the member icons in metaRow (the column gap owns spacing).
  metaCount: {
    marginTop: 0,
  },
  // Info column for the wide row: a uniform 6px gap between the name, meta, and
  // role-pill rows (each of which centers its own contents vertically).
  infoColumn: {
    gap: 6,
  },
  teamAvatar: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  activeBadge: {
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  activeBadgeText: {
    color: theme.colors.accentFillInk,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
  },
  memberIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  memberDotOverflow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  memberTooltipName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  memberTooltipMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: 1,
  },
  rolePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rolePill: {
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  rolePillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  iconButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonDisabled: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  dimmed: {
    opacity: 0.55,
  },
  unavailableText: {
    marginTop: theme.spacing[1],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  emptyCard: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
  },
  restoreButton: {
    marginTop: theme.spacing[3],
    alignSelf: "flex-start",
  },
  restoreFooter: {
    marginTop: theme.spacing[2],
    alignItems: "flex-start",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  editorBody: {
    gap: theme.spacing[3],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldHint: {
    marginTop: -theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  fieldError: {
    marginTop: -theme.spacing[1],
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  textInput: {
    minHeight: 40,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  textArea: {
    minHeight: 88,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlignVertical: "top",
  },
  avatarField: {
    gap: theme.spacing[2],
  },
  avatarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatarControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  avatarSwatch: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  colorTextInput: {
    flex: 1,
    minHeight: 34,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  colorTextInputInvalid: {
    borderColor: theme.colors.destructive,
  },
  membersField: {
    gap: theme.spacing[2],
  },
  membersList: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing[1],
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  memberRowPressed: {
    backgroundColor: theme.colors.surfaceHover,
  },
  // Matches the Changes-tab commit-selection checkbox (16px, muted border,
  // accent when checked) and is always rendered — never hover-revealed.
  memberCheckbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  memberCheckboxChecked: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  memberInfo: {
    flex: 1,
  },
  editorActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
}));

// Stable style arrays for the wide row (hoisted so the JSX doesn't allocate a
// new array each render — same pattern as the personalities section).
const INFO_COLUMN_STYLE = [settingsStyles.rowContent, styles.infoColumn];
const META_COUNT_STYLE = [settingsStyles.rowHint, styles.metaCount];
