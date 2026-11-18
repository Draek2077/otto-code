import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Alert, Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useAgentProfiles } from "../internal/use-agent-profiles";
import { generateAgentProfileId } from "../internal/profile-id";
import type { AgentProfileValue } from "../internal/profile-form-model";
import { AgentProfileEditModal } from "./agent-profile-edit-modal";
import { mergeEditedProfile } from "@/otto/agent-profiles/edits"; // OTTO(profile-continuity)
import { AgentProfileRow } from "./agent-profile-row";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

interface EditTarget {
  mode: "create" | "edit";
  profile?: AgentProfile;
}

import { MemoryRemoval } from "@/otto/agent-profiles/memory-removal"; // OTTO(profile-memory)
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
export function AgentProfilesSection({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { profiles, isSupported, saveProfiles } = useAgentProfiles(serverId);
  const { entries } = useProvidersSnapshot(serverId, { cwd: null });
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const memorySupported = useHostFeature(serverId, "ottoProfileMemory");
  const client = useHostRuntimeClient(serverId);
  const { data: counts, refetch: refreshCounts } = useFetchQuery({
    dataShape: "value",
    queryKey: ["ottoProfileMemoryCounts", serverId],
    enabled: memorySupported && isConnected && !!client,
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected.");
      return client.profileMemoryCounts();
    },
  });
  const [removal, setRemoval] = useState<{ profile: AgentProfile; count: number } | null>(null);
  const closeRemoval = useCallback(() => setRemoval(null), []);
  const finishRemoval = useCallback(async () => {
    if (!removal || !profiles || !profiles.some((p) => p.id === removal.profile.id))
      throw new Error("Profile roster changed.");
    await saveProfiles(profiles.filter((p) => p.id !== removal.profile.id));
    await refreshCounts();
  }, [removal, profiles, saveProfiles, refreshCounts]);
  const handleAddOpen = useCallback(() => setEditTarget({ mode: "create" }), []);
  const handleEditClose = useCallback(() => setEditTarget(null), []);

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = profiles?.find((entry) => entry.id === id);
      if (!profile) {
        return;
      }
      setEditTarget({ mode: "edit", profile });
    },
    [profiles],
  );

  const handleSave = useCallback(
    async (value: AgentProfileValue) => {
      const current = profiles ?? [];
      const editing = editTarget?.mode === "edit" ? editTarget.profile : undefined;
      // OTTO(agent-teams): host broadcasts replace the list. Keep another editor's draft intact.
      if (
        editing &&
        JSON.stringify(current.find((item) => item.id === editing.id)) !== JSON.stringify(editing)
      )
        throw new Error("This Profile changed. Reopen it to edit the new version.");
      const next: AgentProfile[] = editing
        ? current.map((entry) =>
            entry.id === editing.id ? mergeEditedProfile(entry, value) : entry,
          )
        : [...current, { id: generateAgentProfileId(), ...value }];
      await saveProfiles(next);
    },
    [editTarget, profiles, saveProfiles],
  );

  const reorder = useCallback(
    async (id: string, offset: -1 | 1) => {
      if (!profiles) {
        return;
      }
      const index = profiles.findIndex((entry) => entry.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= profiles.length) {
        return;
      }
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveUp = useCallback((id: string) => void reorder(id, -1), [reorder]);
  const handleMoveDown = useCallback((id: string) => void reorder(id, 1), [reorder]);

  const handleRemove = useCallback(
    async (id: string) => {
      const profile = profiles?.find((entry) => entry.id === id);
      if (!profile) {
        return;
      }
      if (memorySupported) {
        try {
          if (!client) throw new Error("Reconnect to this host first.");
          const view = await client.profileMemory({ kind: "view", profileId: id });
          if (view.entries.length) {
            setRemoval({ profile, count: view.entries.length });
            return;
          }
        } catch (error) {
          Alert.alert("Cannot inspect Profile lessons", String(error));
          return;
        }
      }
      void confirmDialog({
        title: t("settings.host.agentProfiles.removeConfirmTitle"),
        message: t("settings.host.agentProfiles.removeConfirmMessage", { name: profile.name }),
        confirmLabel: t("settings.host.agentProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !profiles) {
          return;
        }
        try {
          await saveProfiles(profiles.filter((entry) => entry.id !== id));
        } catch (error) {
          Alert.alert(
            t("common.errors.unableToSave"),
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      });
    },
    [profiles, saveProfiles, t, memorySupported, client],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addIcon}
        onPress={handleAddOpen}
        disabled={!profiles}
        accessibilityLabel={t("settings.host.agentProfiles.addProfileTitle")}
        testID="agent-profiles-add-button"
      />
    ),
    [handleAddOpen, profiles, t],
  );

  if (!isConnected || !isSupported) {
    return (
      <SettingsSection
        title={t("settings.host.agentProfiles.sectionTitle")}
        testID="agent-profiles-section"
      >
        <View style={settingsStyles.card} testID="agent-profiles-unavailable">
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {isConnected
                ? t("settings.host.agentProfiles.unsupported")
                : t("settings.host.agentProfiles.unavailable")}
            </Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <>
      {removal && profiles ? (
        <MemoryRemoval
          hostId={serverId}
          profile={removal.profile}
          count={removal.count}
          profiles={profiles}
          remove={finishRemoval}
          close={closeRemoval}
        />
      ) : null}
      <SettingsSection
        title={t("settings.host.agentProfiles.sectionTitle")}
        trailing={addButton}
        testID="agent-profiles-section"
      >
        <View style={settingsStyles.card} testID="agent-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <AgentProfileRow
                key={profile.id}
                profile={profile}
                lessonCount={counts?.[profile.id]}
                entries={entries}
                isFirst={index === 0}
                isLast={index === profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText} testID="agent-profiles-empty">
                {t("settings.host.agentProfiles.emptyState")}
              </Text>
              <Button size="sm" leftIcon={addIcon} onPress={handleAddOpen} disabled={!profiles}>
                {t("settings.host.agentProfiles.newProfile")}
              </Button>
            </View>
          )}
        </View>
      </SettingsSection>

      <AgentProfileEditModal
        serverId={serverId}
        visible={editTarget !== null}
        mode={editTarget?.mode ?? "create"}
        {...(editTarget?.profile ? { profile: editTarget.profile } : {})}
        onClose={handleEditClose}
        onSave={handleSave}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
