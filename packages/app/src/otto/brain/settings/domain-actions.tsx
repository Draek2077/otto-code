import { useCallback } from "react";
import { View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useBrainSettings, useSettingsControlSize } from "./context";
import { styles } from "./styles";

type Scope = "connection" | "owner";
const operations = {
  connection: { save: "save-connection", reload: "reload-connection" },
  owner: { save: "save-owner", reload: "reload-owner" },
} as const;

export function DomainNotice({ scope }: { scope: Scope }) {
  const { state, snapshot } = useBrainSettings();
  const domain = state[scope];
  if (!domain) return null;
  const changedTarget = scope === "owner" && state.targetChanged;
  const resource = snapshot[scope];
  let message = domain.error ?? (resource.state === "error" ? resource.message : null);
  if (message === null) {
    if (changedTarget) {
      message = `The saved Brain owner changed to ${snapshot.owner.data?.owner.label ?? "another owner"}. Your draft is kept. Reload explicitly to edit the selected owner.`;
    } else if (domain.blocked) {
      message =
        "The saved settings may have changed. Your draft is kept. Reload before saving again.";
    } else if (domain.peerChanged) {
      message = "Saved settings changed elsewhere. Your draft and its original revision are kept.";
    }
  }
  return message ? (
    <Alert variant={domain.error ? "error" : "warning"} description={message} />
  ) : null;
}

function actionVisibility(scope: Scope, state: ReturnType<typeof useBrainSettings>["state"]) {
  const domain = state[scope];
  const credentialChange =
    state.credentials.access.action !== "keep" || state.credentials.huggingFace.action !== "keep";
  const showApply =
    scope === "connection" ? state.credentials.remote.action !== "keep" : credentialChange;
  const showReload =
    !domain ||
    domain.blocked ||
    domain.peerChanged ||
    domain.error ||
    (scope === "owner" && state.targetChanged);
  return { showApply, showReload };
}

export function DomainActions({ scope }: { scope: Scope }) {
  const { state, model, snapshot, flushInputs, active } = useBrainSettings();
  const size = useSettingsControlSize();
  const domain = state[scope];
  const dirty = scope === "connection" ? state.connectionDirty : state.ownerDirty;
  const busy = state.operation !== null || !active || !snapshot.host.connected;
  const save = useCallback(() => {
    flushInputs(scope);
    if (scope === "connection") void model.saveConnection();
    else void model.saveOwner();
  }, [flushInputs, model, scope]);
  const reload = useCallback(() => {
    void model.reload(scope, () =>
      confirmDialog({
        title: "Reload saved settings?",
        message:
          "This replaces the local draft and pending credential edits with the current saved settings.",
        confirmLabel: "Reload",
      }),
    );
  }, [model, scope]);
  const saving = state.operation === operations[scope].save;
  const saveLabel = "Apply key changes";
  const { showApply, showReload } = actionVisibility(scope, state);
  const cannotEdit = scope === "connection" && !snapshot.capabilities.editConnection;
  if (!showApply && !showReload) return null;
  return (
    <View style={styles.actions}>
      {showApply ? (
        <Button
          variant="secondary"
          size={size}
          onPress={save}
          disabled={
            busy ||
            !dirty ||
            domain?.blocked ||
            cannotEdit ||
            (scope === "owner" && state.targetChanged)
          }
        >
          {saving ? "Saving..." : saveLabel}
        </Button>
      ) : null}
      {showReload ? (
        <Button
          variant="outline"
          size={size}
          onPress={reload}
          disabled={busy || (scope === "owner" && snapshot.owner.data === null)}
        >
          {state.operation === operations[scope].reload ? "Reloading..." : "Reload saved settings"}
        </Button>
      ) : null}
    </View>
  );
}
