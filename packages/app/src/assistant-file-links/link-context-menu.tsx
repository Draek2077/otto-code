import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import React from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { useChatContextMenuTarget } from "@/chat/context-menu";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { AssistantFileLinkResolverConfigRef } from "./provider";
import type { InlinePathTarget } from "./parse";
import { getAssistantFileLinkToken, type AssistantFileLinkSource } from "./resolver";

interface AssistantLinkContextMenuProps {
  /**
   * The live provider config, threaded as a prop rather than read from the
   * resolver context. The menu content renders in the chat's context-menu
   * surface, which is a sibling of the transcript and therefore *outside*
   * `AssistantFileLinkResolverProvider` - reading the context there threw and
   * took the whole app down on every right click of a file link.
   */
  configRef: AssistantFileLinkResolverConfigRef;
  source: AssistantFileLinkSource;
  target: InlinePathTarget | null;
  resolve: () => Promise<InlinePathTarget | null>;
  open: (source: AssistantFileLinkSource, disposition: "main" | "side") => void;
  workspaceRoot: string | undefined;
}

export function AssistantLinkContextMenuTarget({
  chatContextMenu,
  configRef,
  source,
  target,
  resolve,
  open,
  workspaceRoot,
  children,
}: AssistantLinkContextMenuProps & {
  chatContextMenu: ReturnType<typeof useChatContextMenuTarget>;
  children: ReactNode;
}) {
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      chatContextMenu?.openTarget(
        event,
        <AssistantLinkContextMenuContent
          configRef={configRef}
          source={source}
          target={target}
          resolve={resolve}
          open={open}
          workspaceRoot={workspaceRoot}
        />,
      );
    },
    [chatContextMenu, configRef, open, resolve, source, target, workspaceRoot],
  );

  return (
    <span onContextMenu={handleContextMenu} style={LINK_CONTEXT_MENU_TRIGGER_STYLE}>
      {children}
    </span>
  );
}

export function AssistantLinkContextMenuContent({
  configRef,
  source,
  target,
  resolve,
  open,
  workspaceRoot,
}: AssistantLinkContextMenuProps) {
  const { t } = useTranslation();
  const [menuTarget, setMenuTarget] = useState(target);
  const resolvedTarget = menuTarget ?? target;
  const workspacePath = useMemo(
    () =>
      resolvedTarget && workspaceRoot
        ? resolveWorkspaceFilePaths({ path: resolvedTarget.path, workspaceRoot })
        : null,
    [resolvedTarget, workspaceRoot],
  );
  const isProjectFile = Boolean(workspacePath?.relativePath);

  useEffect(() => {
    void resolve().then(setMenuTarget);
  }, [resolve]);

  const handleCopyLink = useCallback(() => {
    void Clipboard.setStringAsync(getAssistantFileLinkToken(source));
  }, [source]);
  const handleOpenFile = useCallback(() => open(source, "main"), [open, source]);
  const handleNavigateToFile = useCallback(() => {
    if (resolvedTarget) {
      configRef.current.onNavigateToWorkspaceFile?.(resolvedTarget);
    }
  }, [configRef, resolvedTarget]);
  const handleNavigateToFolder = useCallback(() => {
    if (resolvedTarget) {
      configRef.current.onNavigateToWorkspaceFolder?.(resolvedTarget);
    }
  }, [configRef, resolvedTarget]);

  return (
    <>
      <ContextMenuItem onSelect={handleCopyLink} testID="assistant-file-link-copy">
        {t("message.actions.copyLink")}
      </ContextMenuItem>
      {resolvedTarget ? (
        <ContextMenuItem onSelect={handleOpenFile} testID="assistant-file-link-open-file">
          {t("message.actions.openFile")}
        </ContextMenuItem>
      ) : null}
      {isProjectFile ? (
        <ContextMenuItem
          onSelect={handleNavigateToFile}
          testID="assistant-file-link-navigate-to-file"
        >
          {t("message.actions.navigateToFile")}
        </ContextMenuItem>
      ) : null}
      {isProjectFile ? (
        <ContextMenuItem
          onSelect={handleNavigateToFolder}
          testID="assistant-file-link-navigate-to-folder"
        >
          {t("message.actions.navigateToFolder")}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

const LINK_CONTEXT_MENU_TRIGGER_STYLE = {
  display: "contents",
} as const;
