/**
 * TeamStep — the wizard's team-building step. Replaces the old passive
 * Agents + Teams steps (which only showed the existing roster and let you pick
 * it). Two ways to end up with a team, side by side on one screen:
 *
 *  - Generative (the themed team types): pick "Application", "Creative", … and
 *    Otto builds a fresh, role-complete crew — named personas, provider-bound
 *    brains, colors — that you can reshuffle and install.
 *  - Build your own: name a team and assemble it from your available agents
 *    (the host roster + anyone you just generated), with a live role-coverage
 *    hint so you can build something balanced. Add your own agents in Settings.
 *
 * Mode-gated: the generative cards are the User-lens types (Creative / Management
 * / Planning) in User mode, the Developer-lens ones (Application / Game / Web) in
 * Developer mode. "Build your own" is always offered.
 *
 * Install is additive (the wizard's idempotent contract): it appends the
 * personalities + team to the host roster and activates the team if none is
 * active yet. Feature-gated on agentPersonalities + agentTeams.
 *
 * TODO(i18n): inline English, translated in a later pass.
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import { normalizePersonalityRoles } from "@otto-code/protocol/agent-personalities";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import type { InterfaceMode } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useAgentPersonalitiesFeature } from "@/screens/settings/agent-personalities-section";
import { useAgentTeamsFeature } from "@/screens/settings/agent-teams-section";
import { ROLE_LABELS } from "@/provider-selection/role-labels";
import { blueprintsForLens } from "./presets/blueprints";
import { generateTeam, type GeneratedTeam } from "./presets/generate";
import type { TeamBlueprint } from "./presets/types";

const DEFAULT_TEAM_COLOR = "#4F46E5";

// A random-ish local id for a hand-built team. These are user-owned (editable,
// deletable) — not idempotent-restore targets, so a fresh token per team is fine.
function customTeamId(): string {
  return `team_custom_${Math.random().toString(36).slice(2, 10)}`;
}

interface TeamStepProps {
  serverId: string | null;
  provider: AgentProvider | null;
  interfaceMode: InterfaceMode;
}

/**
 * Imperative handle the wizard shell drives on "Continue": commit whatever the
 * user has staged on this step (a generated preview they selected but didn't
 * explicitly "Add") so moving forward actually creates the team, rather than
 * silently advancing with nothing installed. No-op when nothing is pending or a
 * pending team is already installed.
 */
export interface TeamStepHandle {
  commitPending: () => Promise<void>;
}

export const TeamStep = forwardRef<TeamStepHandle, TeamStepProps>(function TeamStep(
  { serverId, provider, interfaceMode },
  ref,
) {
  const hasPersonalities = useAgentPersonalitiesFeature(serverId ?? "");
  const hasTeams = useAgentTeamsFeature(serverId ?? "");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { entries } = useProvidersSnapshot(serverId);

  const [selected, setSelected] = useState<TeamBlueprint | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [preview, setPreview] = useState<GeneratedTeam | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [installedTeamIds, setInstalledTeamIds] = useState<ReadonlySet<string>>(() => new Set());

  const lens = interfaceMode === "user" ? "user" : "developer";
  const blueprints = useMemo(() => blueprintsForLens(lens), [lens]);

  const providerEntry = useMemo(
    () => (provider ? entries?.find((entry) => entry.provider === provider) : undefined),
    [entries, provider],
  );
  const canGenerate = Boolean(provider && (providerEntry?.models?.length ?? 0) > 0);

  const generate = useCallback(
    (blueprint: TeamBlueprint): GeneratedTeam | null => {
      if (!provider) {
        return null;
      }
      return generateTeam({
        blueprint,
        provider,
        models: providerEntry?.models,
        modes: providerEntry?.modes,
      });
    },
    [provider, providerEntry],
  );

  const handleSelect = useCallback(
    (blueprint: TeamBlueprint) => {
      setSelected(blueprint);
      setCustomOpen(false);
      setPreview(generate(blueprint));
    },
    [generate],
  );

  const handleSelectCustom = useCallback(() => {
    setCustomOpen(true);
    setSelected(null);
    setPreview(null);
  }, []);

  const handleRegenerate = useCallback(() => {
    if (selected) {
      setPreview(generate(selected));
    }
  }, [selected, generate]);

  const markInstalled = useCallback((teamId: string) => {
    setInstalledTeamIds((prev) => {
      const next = new Set(prev);
      next.add(teamId);
      return next;
    });
  }, []);

  // Persist a generated team: append its personalities to the roster and add +
  // activate the team. Throws on failure so callers decide how to surface it.
  const installTeam = useCallback(
    async (generated: GeneratedTeam) => {
      const existingPersonalities = config?.agentPersonalities?.personalities ?? [];
      await patchConfig({
        agentPersonalities: {
          personalities: [...existingPersonalities, ...generated.personalities],
        },
        agentTeams: buildAddTeamPatch(config, generated.team),
      });
      markInstalled(generated.team.id);
    },
    [config, patchConfig, markInstalled],
  );

  const handleAdd = useCallback(() => {
    if (!preview) {
      return;
    }
    setIsAdding(true);
    void (async () => {
      try {
        await installTeam(preview);
      } catch (error) {
        Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
      } finally {
        setIsAdding(false);
      }
    })();
  }, [preview, installTeam]);

  // Driven by the wizard's "Continue" (see setup-wizard-screen). Commits a
  // selected-but-not-yet-added generated team so "pick a team and move forward"
  // actually creates it. Swallows to a toast — a save hiccup must not block the
  // wizard from advancing.
  const commitPending = useCallback(async () => {
    if (!preview || !selected || !config || installedTeamIds.has(preview.team.id)) {
      return;
    }
    try {
      await installTeam(preview);
    } catch (error) {
      Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
    }
  }, [preview, selected, config, installedTeamIds, installTeam]);

  useImperativeHandle(ref, () => ({ commitPending }), [commitPending]);

  if (!hasPersonalities || !hasTeams) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Build your team</Text>
          <Text style={styles.subtitle}>
            This host doesn&rsquo;t support agent teams yet. Update the host to have Otto build you
            a team — you can skip this for now.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>What kind of team do you want?</Text>
        <Text style={styles.subtitle}>
          Pick a team and Otto builds you a complete, balanced crew — named characters with their
          own personalities. Not a fit? Reshuffle. Or build your own from your agents.
        </Text>
      </View>

      <View style={styles.cards}>
        {blueprints.map((blueprint) => (
          <TeamTypeCard
            key={blueprint.id}
            blueprint={blueprint}
            selected={!customOpen && selected?.id === blueprint.id}
            onSelect={handleSelect}
          />
        ))}
        <BuildYourOwnCard selected={customOpen} onSelect={handleSelectCustom} />
      </View>

      {!customOpen && !canGenerate ? <ProviderNotReadyNote provider={provider} /> : null}

      {!customOpen && preview && selected ? (
        <GeneratedPreview
          blueprintName={selected.name}
          team={preview.team}
          personalities={preview.personalities}
          installedTeamIds={installedTeamIds}
          isAdding={isAdding}
          disabled={!config}
          onRegenerate={handleRegenerate}
          onAdd={handleAdd}
        />
      ) : null}

      {customOpen ? (
        <CustomTeamBuilder config={config} patchConfig={patchConfig} onInstalled={markInstalled} />
      ) : null}
    </View>
  );
});

// Build the agentTeams patch for adding one team in the wizard: append it and
// make it the active team. Picking a team in setup is a deliberate choice, so it
// takes over as active — that's the whole point of the step (an earlier version
// only activated when no team was active, which left users stuck on whatever
// team they arrived with even after picking a new one).
function buildAddTeamPatch(
  config: MutableDaemonConfig | null,
  team: NonNullable<GeneratedTeam["team"]>,
): NonNullable<MutableDaemonConfigPatch["agentTeams"]> {
  const existingTeams = config?.agentTeams?.teams ?? [];
  return {
    teams: [...existingTeams, team],
    activeTeamId: team.id,
  };
}

function ProviderNotReadyNote({ provider }: { provider: AgentProvider | null }) {
  return (
    <Text style={styles.note}>
      {provider
        ? "This provider has no models yet — refresh it in Settings, then come back."
        : "Pick a provider first (previous step) so Otto knows which models to use."}
    </Text>
  );
}

function GeneratedPreview({
  blueprintName,
  team,
  personalities,
  installedTeamIds,
  isAdding,
  disabled,
  onRegenerate,
  onAdd,
}: {
  blueprintName: string;
  team: NonNullable<GeneratedTeam["team"]>;
  personalities: AgentPersonality[];
  installedTeamIds: ReadonlySet<string>;
  isAdding: boolean;
  disabled: boolean;
  onRegenerate: () => void;
  onAdd: () => void;
}) {
  const installed = installedTeamIds.has(team.id);
  const memberLabel = personalities.length === 1 ? "1 member" : `${personalities.length} members`;
  return (
    <View style={styles.previewCard}>
      <View style={styles.previewHeader}>
        <Text style={styles.previewTitle}>{blueprintName}</Text>
        <Text style={styles.previewMeta}>{memberLabel}</Text>
      </View>
      <View style={styles.roster}>
        {personalities.map((personality) => (
          <MemberRow key={personality.id} personality={personality} />
        ))}
      </View>
      <View style={styles.previewActions}>
        <Button
          variant="outline"
          size="md"
          onPress={onRegenerate}
          disabled={isAdding}
          testID="team-regenerate"
        >
          Reshuffle
        </Button>
        <Button
          variant="default"
          size="md"
          onPress={onAdd}
          loading={isAdding}
          disabled={isAdding || installed || disabled}
          style={styles.addButton}
          testID="team-add"
        >
          {installed ? "Added ✓" : "Add this team"}
        </Button>
      </View>
    </View>
  );
}

function TeamTypeCard({
  blueprint,
  selected,
  onSelect,
}: {
  blueprint: TeamBlueprint;
  selected: boolean;
  onSelect: (blueprint: TeamBlueprint) => void;
}) {
  const handlePress = useCallback(() => onSelect(blueprint), [blueprint, onSelect]);
  const cardStyle = useMemo(() => [styles.card, selected && styles.cardSelected], [selected]);
  const dotStyle = useMemo(
    () => [styles.cardDot, { backgroundColor: blueprint.accent }],
    [blueprint.accent],
  );
  const a11yState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={a11yState}
      onPress={handlePress}
      style={cardStyle}
      testID={`team-type-${blueprint.id}`}
    >
      <View style={dotStyle} />
      <Text style={styles.cardName} numberOfLines={1}>
        {blueprint.name}
      </Text>
      <Text style={styles.cardTagline} numberOfLines={2}>
        {blueprint.tagline}
      </Text>
    </Pressable>
  );
}

function BuildYourOwnCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const cardStyle = useMemo(
    () => [styles.card, styles.customCard, selected && styles.cardSelected],
    [selected],
  );
  const a11yState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={a11yState}
      onPress={onSelect}
      style={cardStyle}
      testID="team-type-custom"
    >
      <View style={styles.customDot}>
        <Text style={styles.customPlus}>+</Text>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        Build your own
      </Text>
      <Text style={styles.cardTagline} numberOfLines={2}>
        Assemble a team from your agents, your way.
      </Text>
    </Pressable>
  );
}

function CustomTeamBuilder({
  config,
  patchConfig,
  onInstalled,
}: {
  config: MutableDaemonConfig | null;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  onInstalled: (teamId: string) => void;
}) {
  const available = useMemo(
    () => config?.agentPersonalities?.personalities ?? [],
    [config?.agentPersonalities?.personalities],
  );
  const [name, setName] = useState("My Team");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [addedName, setAddedName] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setAddedName(null);
  }, []);

  const selectedMembers = useMemo(
    () => available.filter((personality) => selectedIds.has(personality.id)),
    [available, selectedIds],
  );
  const roleUnion = useMemo(
    () => normalizePersonalityRoles(selectedMembers.flatMap((member) => member.roles ?? [])),
    [selectedMembers],
  );
  const hasOrchestrator = roleUnion.includes("orchestrator");
  const trimmedName = name.trim();
  const canAdd = trimmedName.length > 0 && selectedIds.size > 0 && !isAdding;

  const handleAdd = useCallback(() => {
    if (!canAdd) {
      return;
    }
    setIsAdding(true);
    const memberIds = selectedMembers.map((member) => member.id);
    const team = {
      id: customTeamId(),
      name: trimmedName,
      avatar: { color: selectedMembers[0]?.spinner?.glowA ?? DEFAULT_TEAM_COLOR },
      memberIds,
    };
    void (async () => {
      try {
        await patchConfig({ agentTeams: buildAddTeamPatch(config, team) });
        onInstalled(team.id);
        setAddedName(team.name);
        setSelectedIds(new Set());
        setName("My Team");
      } catch (error) {
        Alert.alert("Unable to save", error instanceof Error ? error.message : String(error));
      } finally {
        setIsAdding(false);
      }
    })();
  }, [canAdd, selectedMembers, trimmedName, config, patchConfig, onInstalled]);

  if (available.length === 0) {
    return (
      <View style={styles.previewCard}>
        <Text style={styles.note}>
          No agents to pick from yet. Generate a team above (that adds agents you can mix in here),
          or add your own in Settings &rsquo; Agents — then come back.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.previewCard}>
      <View style={styles.builderField}>
        <Text style={styles.builderLabel}>Team name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="My Team"
          style={styles.builderInput}
          testID="custom-team-name"
        />
      </View>

      <View style={styles.builderField}>
        <Text style={styles.builderLabel}>
          Members {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
        </Text>
        <View style={styles.roster}>
          {available.map((personality) => (
            <SelectableMemberRow
              key={personality.id}
              personality={personality}
              selected={selectedIds.has(personality.id)}
              onToggle={toggle}
            />
          ))}
        </View>
      </View>

      {selectedIds.size > 0 ? (
        <Text style={styles.coverageHint}>
          {`Covers: ${roleUnion.map((role) => ROLE_LABELS[role]).join(" · ")}`}
          {hasOrchestrator ? "" : "  ·  Tip: add an Orchestrator to give the team a lead."}
        </Text>
      ) : null}

      {addedName ? <Text style={styles.addedHint}>Added “{addedName}” ✓</Text> : null}

      <Button
        variant="default"
        size="md"
        onPress={handleAdd}
        loading={isAdding}
        disabled={!canAdd}
        testID="custom-team-add"
      >
        Add this team
      </Button>
    </View>
  );
}

function MemberRow({ personality }: { personality: AgentPersonality }) {
  const roles = useMemo(() => normalizePersonalityRoles(personality.roles), [personality]);
  const chipStyle = useMemo(
    () => [styles.memberChip, { backgroundColor: personality.spinner?.glowA ?? "#888888" }],
    [personality.spinner?.glowA],
  );
  return (
    <View style={styles.memberRow}>
      <View style={chipStyle} />
      <View style={styles.memberText}>
        <Text style={styles.memberName} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={styles.memberRoles} numberOfLines={1}>
          {roles.map((role) => ROLE_LABELS[role]).join(" · ") || "No roles"}
        </Text>
      </View>
    </View>
  );
}

function SelectableMemberRow({
  personality,
  selected,
  onToggle,
}: {
  personality: AgentPersonality;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(personality.id), [onToggle, personality.id]);
  const roles = useMemo(() => normalizePersonalityRoles(personality.roles), [personality]);
  const rowStyle = useMemo(
    () => [styles.selectableRow, selected && styles.selectableRowSelected],
    [selected],
  );
  const chipStyle = useMemo(
    () => [styles.memberChip, { backgroundColor: personality.spinner?.glowA ?? "#888888" }],
    [personality.spinner?.glowA],
  );
  const checkStyle = useMemo(
    () => [styles.checkbox, selected && styles.checkboxSelected],
    [selected],
  );
  const a11yState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={a11yState}
      onPress={handlePress}
      style={rowStyle}
      testID={`custom-member-${personality.id}`}
    >
      <View style={chipStyle} />
      <View style={styles.memberText}>
        <Text style={styles.memberName} numberOfLines={1}>
          {personality.name}
        </Text>
        <Text style={styles.memberRoles} numberOfLines={1}>
          {roles.map((role) => ROLE_LABELS[role]).join(" · ") || "No roles"}
        </Text>
      </View>
      <View style={checkStyle}>{selected ? <Text style={styles.checkMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: theme.spacing[6],
  },
  header: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize["2xl"] + 2, md: theme.fontSize["2xl"] },
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    lineHeight: { xs: 24, md: 22 },
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    lineHeight: { xs: 22, md: 20 },
  },
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  card: {
    flexGrow: 1,
    flexBasis: { xs: "100%", md: "30%" },
    minWidth: { xs: "100%", md: 150 },
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  customCard: {
    borderStyle: "dashed",
  },
  cardDot: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.full,
  },
  customDot: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
  },
  customPlus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  cardName: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.lg + 2, md: theme.fontSize.lg },
    fontWeight: theme.fontWeight.medium,
  },
  cardTagline: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    lineHeight: { xs: 20, md: 18 },
  },
  previewCard: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  previewTitle: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.lg + 2, md: theme.fontSize.lg },
    fontWeight: theme.fontWeight.semibold,
  },
  previewMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
  },
  roster: {
    gap: theme.spacing[2],
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  memberChip: {
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
  },
  memberText: {
    flex: 1,
  },
  memberName: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    fontWeight: theme.fontWeight.medium,
  },
  memberRoles: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
  },
  previewActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  addButton: {
    flex: 1,
  },
  builderField: {
    gap: theme.spacing[2],
  },
  builderLabel: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    fontWeight: theme.fontWeight.medium,
  },
  builderInput: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  selectableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  selectableRowSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface3,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  checkMark: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
  },
  coverageHint: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    lineHeight: { xs: 22, md: 20 },
  },
  addedHint: {
    color: theme.colors.accent,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
    fontWeight: theme.fontWeight.medium,
  },
}));
