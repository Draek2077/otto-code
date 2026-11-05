import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import type { FileEditorModel } from "@/file-pane/editor/model";
import { usePaneContext } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { EditorSurface } from "./surface";
import { useEditorConnection } from "./client";
import type { CodePort } from "./code/port";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import type { EditorDiagnostic } from "@getpaseo/plugin/otto/editor";
import { listEditorFiles, guardEditorDraft } from "@getpaseo/plugin/otto/editor";
import { EditorDraftGuard } from "./draft-guard";
import { useFetchQuery } from "@/data/query";
import { isMarkdownPath } from "./markdown/markdown-path";
import { useEditorKeyBindings } from "./shortcuts/use-bindings";
import { usePaneFocus } from "@/panels/pane-context";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
const NO_DIAGNOSTICS: readonly EditorDiagnostic[] = [];
const NO_TARGETS: string[] = [];

interface Input {
  workspaceRoot?: string;
  serverId: string;
  root: string;
  file: string;
  model: FileEditorModel;
  active: boolean;
}
export function useOttoEditor(input: Input) {
  const connection = useEditorConnection(input.serverId);
  const latestClient = useRef(connection.client);
  latestClient.current = connection.client;
  const pane = usePaneContext();
  const latestPane = useRef(pane);
  latestPane.current = pane;
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const dispatcher = useKeyboardActionDispatcher();
  const keyBindings = useEditorKeyBindings();
  const focus = usePaneFocus();
  const [keyboardHandlerId] = useState(uuid);
  const { settings } = useAppSettings();
  const rendering = useMemo(
    () => ({
      vimMappings: settings.vimMappings,
      rulerEnabled: settings.rulerEnabled,
      rulerColumn: settings.rulerColumn,
    }),
    [settings.vimMappings, settings.rulerEnabled, settings.rulerColumn],
  );
  const active = useRef(false);
  const documentVisible = useRef(false);
  documentVisible.current = retained && visible;
  active.current = input.active && retained && visible;
  const [surface] = useState(() => {
    const version = input.model.getSnapshot().version;
    const root = version.status === "ready" ? version.cwd : input.root;
    const paths = resolveWorkspaceFilePaths({ path: input.file, workspaceRoot: root });
    return new EditorSurface({
      hostId: input.serverId,
      documentVisible: () => documentVisible.current,
      async exportDocument(text, extension) {
        const client = latestClient.current;
        if (!client) throw new Error("Connect the host to export this document.");
        const { exportDocument } = await import("./markdown/export/document");
        const result = await exportDocument(
          client,
          root,
          paths?.absolutePath ?? input.file,
          text,
          extension,
        );
        return {
          file: result.file,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        };
      },
      workspaceOwned: Boolean(
        input.workspaceRoot &&
        resolveWorkspaceFilePaths({
          path: paths?.absolutePath ?? input.file,
          workspaceRoot: input.workspaceRoot,
        })?.relativePath,
      ),
      workspaceId: pane.workspaceId,
      attach(range) {
        const scopeKey = buildWorkspaceAttachmentScopeKey({
          serverId: input.serverId,
          workspaceId: latestPane.current.workspaceId,
          cwd: root,
        });
        const file = paths?.relativePath ?? input.file;
        const attachment = {
          kind: "editor_context" as const,
          id: JSON.stringify([file, range]),
          file,
          range,
          // Match the existing file-context contract: ordinary selections are
          // references, not a second copy of the source in every model turn.
          excerpt: "",
          note: "",
          locator: "source" as const,
        };
        const store = useWorkspaceAttachmentsStore.getState();
        store.addWorkspaceAttachment({ scopeKey, attachment });
      },
      model: input.model,
      root,
      file: paths?.absolutePath ?? input.file,
      documentId: uuid(),
      navigate(location) {
        latestPane.current.openFileInWorkspace({
          disposition: "preferred",
          location: {
            path: location.file,
            lineStart: location.range.start.line + 1,
            lineEnd: location.range.end.line + 1,
            columnStart: location.range.start.character + 1,
            columnEnd: location.range.end.character + 1,
          },
        });
      },
    });
  });
  const files = useFetchQuery({
    queryKey: ["ottoEditorLinkTargets", input.serverId, input.root],
    enabled:
      input.active &&
      retained &&
      visible &&
      isMarkdownPath(input.file) &&
      surface.workspaceOwned &&
      connection.client !== null,
    dataShape: "list",
    staleTimeMs: 60000,
    retry: false,
    queryFn: async () => {
      const client = connection.client;
      if (!client) throw new Error("Connect the host to list Markdown link targets.");
      return (await client.call(listEditorFiles, { hostId: client.hostId, root: input.root }))
        .files;
    },
  });
  useEffect(() => {
    const client = connection.client;
    if (!client) return;
    const documentId = uuid();
    const guard = new EditorDraftGuard(client.hostId, (modified, revision) =>
      client.call(guardEditorDraft, {
        hostId: client.hostId,
        root: input.root,
        file: surface.file,
        documentId,
        modified,
        revision,
      }),
    );
    const update = () => guard.update(input.model.getSnapshot().modified);
    const release = input.model.subscribe(update);
    update();
    return () => {
      release();
      void guard.close();
    };
  }, [connection.client, input.model, input.root, surface]);
  useEffect(() => surface.setMarkdownTargets(files.data ?? NO_TARGETS), [surface, files.data]);
  useEffect(() => {
    if (!input.active || !retained || !visible) return;
    return surface.activate(connection.client);
  }, [surface, connection.client, input.active, retained, visible]);
  useEffect(
    () =>
      dispatcher.registerHandler({
        handlerId: keyboardHandlerId,
        actions: ["editor.execute"],
        enabled: input.active && retained && visible && focus.isInteractive,
        priority: 100,
        handle(action) {
          if (action.id !== "editor.execute") return false;
          return surface.keyboard(action.command);
        },
      }),
    [dispatcher, keyboardHandlerId, input.active, retained, visible, focus.isInteractive, surface],
  );
  const code = useMemo<CodePort>(
    () => ({
      scroll: {
        enabled: surface.scroll.isEnabled,
        report: (fraction) => surface.scroll.report("source", fraction),
        subscribe: (listener) => surface.scroll.listen("source", listener),
      },
      request: (action, position) => surface.request(action, position),
      position: (position) => surface.setPosition(position),
      selection: (characters, lines, range) => surface.setSelection(characters, lines, range),
      action(action) {
        if (action === "rename") surface.requestRename();
        else void surface.run(action);
      },
      diagnostics: () => surface.getSnapshot().observation?.diagnostics ?? NO_DIAGNOSTICS,
      subscribe: surface.subscribe,
      onCommand: surface.onCommand,
      active: () => active.current,
      activation: () => surface.activation,
      rendering: () => rendering,
      markdown: () => surface.getSnapshot().markdown,
      keyBindings: () => keyBindings,
      writeImage: (image) => surface.writeImage(image),
      reportError: (message) => surface.reportError(message),
      leaderPending: (sequence) => surface.leaderPending(sequence),
      vimAction(action) {
        switch (action) {
          case "save":
            void input.model.save();
            break;
          case "find":
            surface.command("find");
            break;
          case "goToDefinition":
            void surface.run("definition");
            break;
          case "findReferences":
            void surface.run("references");
            break;
          case "renameSymbol":
            surface.requestRename();
            break;
          case "openFileSearch":
            useKeyboardShortcutsStore.getState().setCommandCenterOpen(true, "files");
            break;
          case "openChanges":
            latestPane.current.openTab({ kind: "changes_tree" });
            break;
          case "newTerminal":
            if (!dispatcher.dispatch({ id: "workspace.terminal.new", scope: "workspace" }))
              surface.reportError("A terminal cannot be opened in this workspace right now.");
            break;
        }
      },
    }),
    [surface, rendering, input.model, dispatcher, keyBindings],
  );
  return { surface, code, available: connection.state === "ready", state: connection.state };
}
