import { useEffect, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Architecture } from "@/components/icons/material-icons";
import {
  InteractiveViewActions,
  InteractiveViewCanvas,
  InteractiveViewStatus,
  type InteractiveViewSourceStatus,
} from "@/components/architectural-views/interactive-view";
import { useInteractiveView } from "@/architectural-views/use-interactive-view";
import type { ArchitecturalViewDiagramType } from "@/project-knowledge/architectural-view-types";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

type ArchitecturalViewTarget = Extract<WorkspaceTabTarget, { kind: "architecturalView" }>;

function useArchitecturalViewPanelDescriptor(target: ArchitecturalViewTarget): PanelDescriptor {
  return {
    label: target.viewId,
    tooltip: `Interactive View: ${target.viewId}`,
    subtitle: "Published Interactive View",
    titleState: "ready",
    icon: Architecture,
    statusBucket: null,
  };
}

function ArchitecturalViewPanel(): ReactElement {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(
    target.kind === "architecturalView",
    "ArchitecturalViewPanel requires architecturalView target",
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.architecturalViews === true,
  );
  const [html, setHtml] = useState<string | null>(null);
  const [title, setTitle] = useState(target.viewId);
  const [sourceStatus, setSourceStatus] = useState<InteractiveViewSourceStatus>("unknown");
  const [diagramType, setDiagramType] = useState<ArchitecturalViewDiagramType | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const view = useInteractiveView(html);

  useEffect(() => {
    if (!client || !supported) {
      setHtml(null);
      setError("Update the host to use Interactive Views.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .getArchitecturalViewContent({ workspaceId, viewId: target.viewId })
      .then((result) => {
        if (cancelled) return;
        if (!result.success || !result.html || !result.view) {
          throw new Error(result.error ?? "Could not open Interactive View.");
        }
        setHtml(result.html);
        setTitle(result.view.title);
        setSourceStatus(result.view.sourceStatus ?? "unknown");
        setDiagramType(result.view.diagramType);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setHtml(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, supported, target.viewId, workspaceId]);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <InteractiveViewActions controller={view} />
      </View>
      <InteractiveViewCanvas
        controller={view}
        html={html}
        loading={loading}
        error={error}
        sourceStatus={sourceStatus}
      />
      <InteractiveViewStatus
        controller={view}
        diagramType={diagramType}
        sourceStatus={sourceStatus}
      />
    </View>
  );
}

export const architecturalViewPanelRegistration = definePanel("architecturalView", {
  component: ArchitecturalViewPanel,
  useDescriptor: useArchitecturalViewPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
    marginRight: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
