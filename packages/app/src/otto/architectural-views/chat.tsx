import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { ViewAuthoringContext, ViewSummary } from "@getpaseo/plugin/otto/architectural-views";
import { useIsCompactFormFactor } from "@/constants/layout";
import { RetainedPanel, useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { Button } from "@/components/ui/button";
import { useViewDocument, useViewLibrary } from "./data";
import { ViewChangeLease } from "./changes";
import { ViewDraftEditor } from "./draft-editor";
import { ViewAuthoringSplit } from "./split";
import { openArchitecturalViews } from "./navigation";
import { styles } from "./styles";
const noWorkspaces: { value: string; label: string }[] = [];
export function ArchitecturalAuthoringChat({
  context,
  agentId,
  children,
}: {
  context: z.infer<typeof ViewAuthoringContext>;
  agentId: string;
  children: ReactNode;
}) {
  const retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    active = retained && visible,
    compact = useIsCompactFormFactor();
  const [pane, setPane] = useState<"chat" | "view">("chat");
  const scope = useMemo(
    () => ({
      hostId: context.hostId,
      target: { kind: "workspace" as const, id: context.workspaceId },
    }),
    [context.hostId, context.workspaceId],
  );
  const selection = useMemo(
    () => ({ kind: "draft" as const, draftId: context.draftId }),
    [context.draftId],
  );
  const library = useViewLibrary(scope, active);
  const document = useViewDocument(scope, context.identity, selection, active);
  const showChat = useCallback(() => setPane("chat"), []),
    showView = useCallback(() => setPane("view"), []);
  const published = useCallback(
    (view: ViewSummary) =>
      openArchitecturalViews(scope, {
        identity: { viewId: view.viewId, origin: view.origin },
        selection: { kind: "published" },
      }),
    [scope],
  );
  const discarded = useCallback(() => openArchitecturalViews(scope), [scope]);
  const draft =
    document.data?.kind === "draft" && document.data.draft.authoringAgentId === agentId
      ? document.data
      : null;
  const preview = draft ? (
    <ViewDraftEditor
      document={draft}
      scope={scope}
      identity={context.identity}
      active={active && (!compact || pane === "view")}
      workspaceId={context.workspaceId}
      workspaces={noWorkspaces}
      published={published}
      discarded={discarded}
      authoring={false}
    />
  ) : (
    <View style={styles.content}>
      <Text style={styles.muted}>
        {document.error?.message ?? "Reading this chat's saved View draft..."}
      </Text>
    </View>
  );
  return (
    <View style={styles.page}>
      {library.data?.origins.map((origin) => (
        <ViewChangeLease
          key={origin.storeKey}
          hostId={context.hostId}
          projectId={library.data.projectId}
          origin={origin}
          active={active}
        />
      ))}
      {compact ? (
        <>
          <View style={styles.toolbar}>
            <View style={styles.row}>
              <Button
                size="sm"
                variant={pane === "chat" ? "secondary" : "outline"}
                onPress={showChat}
              >
                Chat
              </Button>
              <Button
                size="sm"
                variant={pane === "view" ? "secondary" : "outline"}
                onPress={showView}
              >
                View
              </Button>
            </View>
          </View>
          <RetainedPanel active={pane === "chat"}>{children}</RetainedPanel>
          <RetainedPanel active={pane === "view"}>{preview}</RetainedPanel>
        </>
      ) : (
        <ViewAuthoringSplit>
          {children}
          {preview}
        </ViewAuthoringSplit>
      )}
    </View>
  );
}
