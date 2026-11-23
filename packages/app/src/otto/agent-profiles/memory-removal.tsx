import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { styles } from "../context-management/styles";
import { confirmDialog } from "@/utils/confirm-dialog";
import { hasProfileRole, profileRoles } from "@getpaseo/protocol/otto/agent-teams";
const removalHeader = { title: "Remove Profile" };
export function MemoryRemoval({
  hostId,
  profile,
  count,
  profiles,
  remove,
  close,
}: {
  hostId: string;
  profile: AgentProfile;
  count: number;
  profiles: AgentProfile[];
  remove: () => Promise<void>;
  close: () => void;
}) {
  const client = useHostRuntimeClient(hostId);
  const [destination, choose] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const options = useMemo(() => {
    const peers = profiles.filter((p) => p.id !== profile.id);
    const shared = (p: AgentProfile) =>
      profileRoles.some((role) => hasProfileRole(profile, role) && hasProfileRole(p, role));
    return [
      { value: "", label: "Choose a Profile" },
      ...peers
        .toSorted((a, b) => Number(shared(b)) - Number(shared(a)))
        .map((p) => ({ label: p.name, value: p.id })),
    ];
  }, [profiles, profile]);
  const cancel = useCallback(() => {
    if (!lock.current) close();
  }, [close]);
  const finish = useCallback(
    async (transfer: boolean) => {
      if (!client || lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        if (
          !transfer &&
          !(await confirmDialog({
            title: "Delete Profile and lessons?",
            message: profile.name + "’s lessons will be permanently deleted.",
            destructive: true,
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
          }))
        )
          return;
        await client.profileMemory(
          transfer
            ? { kind: "transfer", profileId: profile.id, destination }
            : { kind: "clear", profileId: profile.id },
        );
        await remove();
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Check the host before trying again.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [client, destination, profile, remove, close],
  );
  const move = useCallback(() => void finish(true), [finish]);
  const discard = useCallback(() => void finish(false), [finish]);
  return (
    <AdaptiveModalSheet header={removalHeader} visible onClose={cancel} desktopMaxWidth={480}>
      <View style={styles.content}>
        <Text style={styles.caption}>
          {profile.name +
            " has " +
            count +
            " remembered lessons. Transfer them before removing this Profile, or delete them."}
        </Text>
        <SettingsSelect
          label="Transfer to"
          options={options}
          value={destination}
          onValueChange={choose}
        />
        {error ? <Alert variant="error" description={error} /> : null}
        <View style={styles.actions}>
          <Button disabled={!destination || busy} onPress={move}>
            Transfer and remove
          </Button>
          <Button variant="outline" disabled={busy} onPress={discard}>
            Delete lessons and Profile
          </Button>
          <Button variant="ghost" disabled={busy} onPress={cancel}>
            Cancel
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}
