import { useCallback, useMemo } from "react";
import { BookOpen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useInstalledPlugin } from "@/plugins/registry";
import { createPluginNavigation } from "@/plugins/navigation";
const ThemedBook = withUnistyles(BookOpen);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const leading = <ThemedBook size={14} uniProps={color} />;
/** Bind the clicked row, including when a different workspace is currently active. */
export function KnowledgeWorkspaceMenuItem({
  serverId,
  workspaceId,
  surface,
}: {
  serverId?: string;
  workspaceId?: string;
  surface: "context" | "dropdown";
}) {
  const plugin = useInstalledPlugin(serverId ?? "", "otto-project-knowledge");
  const navigation = useMemo(
    () => createPluginNavigation({ serverId: serverId ?? "", workspaceId: workspaceId ?? null }),
    [serverId, workspaceId],
  );
  const open = useCallback(
    () => navigation.openWorkspacePanel("otto-project-knowledge", "knowledge", "workspace"),
    [navigation],
  );
  if (
    !serverId ||
    !workspaceId ||
    !plugin?.workspacePanels.some(
      (panel) => panel.id === "knowledge" && panel.context === "workspace",
    )
  )
    return null;
  if (surface === "context")
    return (
      <ContextMenuItem onSelect={open} leading={leading}>
        Open Project Knowledge
      </ContextMenuItem>
    );
  return (
    <DropdownMenuItem onSelect={open} leading={leading}>
      Open Project Knowledge
    </DropdownMenuItem>
  );
}
