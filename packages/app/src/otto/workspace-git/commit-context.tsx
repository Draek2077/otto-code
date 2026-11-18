import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, type GestureResponderEvent } from "react-native";
import { Check, Minus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useHostFeature } from "@/runtime/host-features";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { ManualCommitDraft, type CommitFile } from "./manual-commit";

const Context = createContext<ManualCommitDraft | null>(null);
export const useManualCommitDraft = () => useContext(Context);
const CheckIcon = withUnistyles(Check, (theme) => ({ color: theme.colors.accentForeground }));
const PartialIcon = withUnistyles(Minus, (theme) => ({ color: theme.colors.accentForeground }));
function checkboxMark(checked: boolean | "mixed") {
  if (checked === "mixed") return <PartialIcon size={12} />;
  return checked ? <CheckIcon size={12} /> : null;
}
export function CommitCheckbox({
  checked,
  onPress,
  label,
  disabled = false,
  testID,
}: {
  checked: boolean | "mixed";
  onPress(): void;
  label: string;
  disabled?: boolean;
  testID?: string;
}) {
  const state = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const press = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  return (
    <PressHighlight
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={state}
      disabled={disabled}
      onPress={press}
      testID={testID}
      style={styles.hitbox}
    >
      <View style={[styles.box, checked !== false && styles.selected]}>
        {checkboxMark(checked)}
      </View>
    </PressHighlight>
  );
}
function FileCheckbox({ model, path }: { model: ManualCommitDraft; path: string }) {
  const snapshot = useCallback(() => model.selected(path), [model, path]);
  const checked = useSyncExternalStore(model.subscribe, snapshot);
  const toggle = useCallback(() => model.toggle(path), [model, path]);
  return (
    <CommitCheckbox
      checked={checked}
      onPress={toggle}
      label={`Select ${path} for commit`}
      testID={`changes-commit-select-${path}`}
    />
  );
}
export function ManualCommitFileCheckbox({ path, enabled }: { path: string; enabled: boolean }) {
  const model = useManualCommitDraft();
  return model && enabled ? <FileCheckbox model={model} path={path} /> : null;
}
export function ManualCommitScope({
  serverId,
  cwd,
  enabled,
  isGit,
  diffMode,
  presentation,
  files,
  children,
}: {
  serverId: string;
  cwd: string;
  enabled: boolean | undefined;
  isGit: boolean;
  diffMode: string;
  presentation: string;
  files: readonly CommitFile[];
  children: ReactNode;
}) {
  // COMPAT(ottoManualCommit): added v0.10.0; drop gate after 2027-05-15 when host floor includes selected-file commits.
  const supported = useHostFeature(serverId, "ottoManualCommit");
  const model = useMemo(
    () =>
      new ManualCommitDraft(async (message, paths, onOutput) => {
        const actions = useCheckoutGitActionsStore.getState();
        if (actions.getStatus({ serverId, cwd, actionId: "commit" }) === "pending")
          throw new Error("Another commit is running. Wait for it to finish.");
        await actions.commit({ serverId, cwd, message, paths, onOutput });
      }),
    [serverId, cwd],
  );
  useLayoutEffect(() => {
    model.setFiles(files);
  }, [model, files]);
  return (
    <Context.Provider
      value={
        enabled !== false &&
        isGit &&
        diffMode === "uncommitted" &&
        presentation !== "diff" &&
        files.length > 0 &&
        supported
          ? model
          : null
      }
    >
      {children}
    </Context.Provider>
  );
}
const styles = StyleSheet.create((theme) => ({
  hitbox: { width: 24, height: 28, justifyContent: "center", alignItems: "center", flexShrink: 0 },
  box: {
    width: 16,
    height: 16,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  selected: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
}));
