import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import {
  discoverWorkspaceRefineFiles,
  type ContextNodeSchema,
} from "@getpaseo/plugin/otto/context-management";
import type { z } from "zod";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SettingsCard, SettingsCollapsibleRow } from "@/components/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHostFeature } from "@/runtime/host-features";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { ContextCompaction } from "@/otto/context-management/compaction";
import { ContextEdgeEdit } from "@/otto/context-management/edge-edit";
import { flushEditorDraftGuards } from "./draft-guard";
import type { EditorSurface } from "./surface";
import { isRefinableDocument } from "@getpaseo/plugin/otto/context-management";
export { isRefinableDocument };

const header = { title: "Refine" };
interface Discovery {
  nodes: z.infer<typeof ContextNodeSchema>[];
  selectedId: string;
}

export function useEditorRefine(surface: EditorSurface) {
  const { hostId, workspaceId } = surface.contextScope;
  // COMPAT(ottoWorkspaceRefine): added v0.10.0; remove after 2027-05-20.
  const supported = useHostFeature(hostId, "ottoWorkspaceRefine");
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const client = useHostRuntimeClient(hostId);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Discovery | null>(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const review = useRef({ draft: false, busy: false });
  const updateReview = useCallback((draft: boolean, busy: boolean) => {
    review.current = { draft, busy };
  }, []);
  const close = useCallback(() => {
    opening.current += 1;
    setOpen(false);
  }, []);
  const confirmDiscard = useCallback(
    async () =>
      !review.current.busy &&
      (!review.current.draft ||
        confirmDialog({
          title: "Discard the Refine proposal?",
          message: "Your saved files stay as they are.",
          confirmLabel: "Discard proposal",
        })),
    [],
  );
  const dismiss = useCallback(async () => {
    if (await confirmDiscard()) close();
  }, [close, confirmDiscard]);
  const opening = useRef(0);
  const addFile = useCallback(
    async (file: string) => {
      if (!workspaceId || !client || files.includes(file)) return;
      if (files.length >= 12) {
        setError("A Refine set can contain up to twelve documents.");
        return;
      }
      const authority = opening.current;
      if (!(await confirmDiscard()) || opening.current !== authority) return;
      const next = [...files, file];
      try {
        const discovered = await discover(client, hostId, workspaceId, next);
        if (opening.current !== authority) return;
        setError("");
        setFiles(next);
        setResult(discovered);
      } catch (failure) {
        if (opening.current === authority) setError(message(failure));
      }
    },
    [client, confirmDiscard, files, hostId, workspaceId],
  );
  const show = useCallback(() => {
    opening.current += 1;
    setError("");
    setResult(null);
    setFiles([surface.file]);
    review.current = { draft: false, busy: false };
    setOpen(true);
  }, [surface.file]);
  useEffect(() => {
    if (!active || !open || !client || !workspaceId) return;
    let current = true;
    const activeClient = client;
    const owningWorkspace = workspaceId;
    async function load() {
      try {
        const response = await discover(activeClient, hostId, owningWorkspace, [surface.file]);
        if (current) setResult(response);
      } catch (failure) {
        if (current) setError(message(failure));
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [active, client, hostId, open, surface.file, workspaceId]);
  const invoke = useCallback(
    (method: string, input: unknown) => {
      if (!client) return Promise.reject(new Error("Connect to the workspace host."));
      return client.invokePluginRpc("otto-project-knowledge", method, input);
    },
    [client],
  );
  const available =
    supported && !!workspaceId && surface.workspaceOwned && isRefinableDocument(surface.file);
  const dialog =
    active && open && available && workspaceId ? (
      <AdaptiveModalSheet
        header={header}
        visible
        onClose={dismiss}
        scrollable={false}
        desktopHeight="80%"
        testID="editor-refine-dialog"
      >
        <AdditionalFileInput onAdd={addFile} />
        {error ? <Alert variant="error" description={error} /> : null}
        {!error && !result ? <Text style={styles.loading}>Reading documents…</Text> : null}
        {result ? (
          <PluginRpcProvider invoke={invoke}>
            <RefineReview
              key={JSON.stringify(files)}
              discovery={result}
              additionalRewriteIds={files}
              onReviewState={updateReview}
              surface={surface}
              hostId={hostId}
              workspaceId={workspaceId}
              close={close}
            />
          </PluginRpcProvider>
        ) : null}
      </AdaptiveModalSheet>
    ) : null;
  const menuItem = available ? (
    <DropdownMenuItem onSelect={show} testID="editor-refine">
      Refine with AI
    </DropdownMenuItem>
  ) : null;
  return { menuItem, dialog };
}

async function discover(
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>,
  hostId: string,
  workspaceId: string,
  files: string[],
) {
  const value = await client.invokePluginRpc(
    "otto-project-knowledge",
    discoverWorkspaceRefineFiles.name,
    {
      hostId,
      workspaceId,
      files,
    },
  );
  const result = discoverWorkspaceRefineFiles.output.parse(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The host could not read the selected document.";
}

function AdditionalFileInput({ onAdd }: { onAdd(file: string): Promise<void> }) {
  const [path, setPath] = useState("");
  const submit = useCallback(() => {
    if (path.trim()) void onAdd(path.trim());
  }, [onAdd, path]);
  return (
    <SettingsCard>
      <SettingsCollapsibleRow label="Add another document">
        <FormTextInput
          initialValue=""
          onChangeText={setPath}
          accessibilityLabel="Workspace-relative document path"
          placeholder="docs/example.md"
        />
        <Button size="sm" disabled={!path.trim()} onPress={submit}>
          Add document
        </Button>
      </SettingsCollapsibleRow>
    </SettingsCard>
  );
}

function RefineReview({
  discovery,
  additionalRewriteIds,
  onReviewState,
  surface,
  hostId,
  workspaceId,
  close,
}: {
  discovery: Discovery;
  additionalRewriteIds: readonly string[];
  onReviewState(draft: boolean, busy: boolean): void;
  surface: EditorSurface;
  hostId: string;
  workspaceId: string;
  close(): void;
}) {
  const [lane] = useState(() => new ContextEdgeEdit());
  const state = useSyncExternalStore(lane.subscribe, lane.getSnapshot, lane.getSnapshot);
  useEffect(() => lane.activate(), [lane]);
  const scope = useMemo(
    () => ({
      hostId,
      workspaceId,
      agentId: null,
      windowTokens: 1024,
      workspaceFiles: true as const,
    }),
    [hostId, workspaceId],
  );
  const beforeWrite = useCallback(async () => {
    if (surface.hasUnsavedDocument())
      throw new Error("Save the open editor draft before applying Refine changes.");
    await flushEditorDraftGuards(hostId);
  }, [hostId, surface]);
  const onReviewed = useCallback(async () => {
    lane.reset();
  }, [lane]);
  const changed = useCallback(() => undefined, []);
  return (
    <ContextCompaction
      scope={scope}
      nodes={discovery.nodes}
      additionalRewriteIds={additionalRewriteIds}
      onReviewState={onReviewState}
      selectedId={discovery.selectedId}
      writeModel={lane}
      writeState={state}
      onClose={close}
      onChanged={changed}
      onReviewed={onReviewed}
      beforeWrite={beforeWrite}
      active
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: { color: theme.colors.foregroundMuted, padding: theme.spacing[3] },
}));
