import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { setWorkspaceComparisonBase } from "@getpaseo/plugin/otto/workspace-git";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";

const DEFAULT = "repository-default";
export function ComparisonBasePicker(props: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  branchName: string | null;
  baseRef?: string;
  visible: boolean;
}) {
  const { serverId, workspaceId, cwd, branchName, baseRef, visible } = props;
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(ottoGitDiffBase): added v0.10.0; remove after 2027-05-17 when host floor >= v0.10.0.
  const supported = useHostFeature(serverId, "ottoGitDiffBase");
  const queryClient = useQueryClient();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const canEdit = supported && connected && Boolean(client && workspaceId && branchName);
  const branches = useFetchQuery({
    queryKey: ["ottoComparisonBranches", serverId, cwd],
    enabled: visible && open && canEdit,
    dataShape: "list",
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Reconnect the host to load branches.");
      const response = await client.getBranchSuggestions({ cwd, limit: 200 });
      if (response.error) throw new Error(response.error);
      return response.branchDetails ?? [];
    },
  });
  const options = useMemo<ComboboxOption[]>(() => {
    const values: ComboboxOption[] = [{ id: DEFAULT, label: "Repository default" }];
    for (const branch of branches.data ?? []) {
      if (branch.hasLocal && branch.name !== branchName)
        values.push({ id: `refs/heads/${branch.name}`, label: branch.name });
      if (branch.hasRemote)
        values.push({ id: `refs/remotes/origin/${branch.name}`, label: `origin/${branch.name}` });
    }
    return values;
  }, [branches.data, branchName]);
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        disabled={pending || !connected}
      />
    ),
    [pending, connected],
  );
  const select = useCallback(
    async (id: string) => {
      if (!client || !workspaceId || !branchName || !canEdit || saving.current) return;
      saving.current = true;
      setPending(true);
      setError("");
      try {
        const result = setWorkspaceComparisonBase.output.parse(
          await client.invokePluginRpc("otto-workspace-git", setWorkspaceComparisonBase.name, {
            hostId: serverId,
            workspaceId,
            branchName,
            baseRef: id === DEFAULT ? null : id,
          }),
        );
        if (!result.ok) throw new Error(result.error.message);
        await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });
        setOpen(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The parent branch could not be changed. Choose a branch to try again.",
        );
      } finally {
        saving.current = false;
        setPending(false);
      }
    },
    [client, workspaceId, branchName, canEdit, serverId, queryClient, cwd],
  );
  const handleSelect = useCallback(
    (id: string) => {
      void select(id);
    },
    [select],
  );
  const handleOpen = useCallback(() => setOpen(true), []);
  const { refetch } = branches;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);
  const footer = useMemo(
    () => (
      <ComparisonBaseFeedback
        pending={pending}
        error={error}
        loadFailed={branches.isError}
        connected={connected}
        reload={reload}
      />
    ),
    [pending, error, branches.isError, connected, reload],
  );
  if (!visible) return null;
  const label = baseRef?.replace(/^refs\/(heads|remotes)\//, "") ?? "base";
  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <ToolbarLabelSelectTrigger
        testID="changes-diff-base"
        label={`vs ${label}`}
        open={open}
        disabled={!canEdit || pending}
        accessibilityRole="button"
        accessibilityLabel={
          supported ? `Parent branch (${label})` : "Update the host to change the parent branch"
        }
        onPress={handleOpen}
      />
      <Combobox
        title="Parent branch"
        options={options}
        renderOption={renderOption}
        value={baseRef ?? DEFAULT}
        onSelect={handleSelect}
        keepOpenOnSelect
        open={visible && open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        searchPlaceholder="Search branches..."
        emptyText={branches.isPending ? "Loading branches..." : "No matching branches"}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        footer={footer}
      />
    </View>
  );
}
function ComparisonBaseFeedback({
  pending,
  error,
  loadFailed,
  connected,
  reload,
}: {
  pending: boolean;
  error: string;
  loadFailed: boolean;
  connected: boolean;
  reload(): void;
}) {
  if (!pending && !error && !loadFailed && connected) return null;
  const message = pending
    ? "Updating parent branch..."
    : error ||
      (!connected
        ? "Reconnect the host to change the parent branch."
        : "Branches could not be loaded.");
  return (
    <View style={styles.footer}>
      <Text style={styles.message} accessibilityRole={error || loadFailed ? "alert" : undefined}>
        {message}
      </Text>
      {loadFailed ? (
        <Button size="sm" variant="ghost" onPress={reload}>
          Reload branches
        </Button>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  anchor: { minWidth: 0, flexShrink: 1 },
  footer: { padding: theme.spacing[3], gap: theme.spacing[2] },
  message: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
