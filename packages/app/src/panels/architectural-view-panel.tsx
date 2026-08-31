import { useEffect, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Architecture } from "@/components/icons/material-icons";
import { ArchitecturalViewHtml } from "@/components/architectural-views/architectural-view-html";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

type ArchitecturalViewTarget = Extract<WorkspaceTabTarget, { kind: "architecturalView" }>;

function useArchitecturalViewPanelDescriptor(target: ArchitecturalViewTarget): PanelDescriptor {
  return {
    label: target.viewId,
    tooltip: `Architectural View: ${target.viewId}`,
    subtitle: "Published Architectural View",
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
  const [sourceStatus, setSourceStatus] = useState<"current" | "stale" | "unknown">("unknown");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !supported) {
      setHtml(null);
      setError("Update the host to use Architectural Views.");
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
          throw new Error(result.error ?? "Could not open Architectural View.");
        }
        setHtml(result.html);
        setTitle(result.view.title);
        setSourceStatus(result.view.sourceStatus ?? "unknown");
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

  const freshness = architecturalViewFreshnessLabel(sourceStatus);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text style={sourceStatus === "stale" ? styles.stale : styles.status}>{freshness}</Text>
      </View>
      {html ? (
        <ArchitecturalViewHtml html={html} />
      ) : (
        <View style={styles.centered}>
          {loading ? <LoadingSpinner size="small" /> : null}
          <Text style={styles.message}>{error ?? "Loading Architectural View…"}</Text>
        </View>
      )}
    </View>
  );
}

export const architecturalViewPanelRegistration = definePanel("architecturalView", {
  component: ArchitecturalViewPanel,
  useDescriptor: useArchitecturalViewPanelDescriptor,
});

function architecturalViewFreshnessLabel(status: "current" | "stale" | "unknown"): string {
  if (status === "stale") return "Source changed since this view was published";
  if (status === "unknown") return "Source freshness is unavailable for this view";
  return "Published from current Knowledge";
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  stale: { color: theme.colors.statusWarning, fontSize: theme.fontSize.xs },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
