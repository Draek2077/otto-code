import { useCallback } from "react";
import { router } from "expo-router";
import type { ScheduleResultLink as Result } from "@getpaseo/plugin/otto/schedules";
import { Button } from "@/components/ui/button";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { openWorkflow } from "../workflows/navigation";
export function ScheduleResultLink({ hostId, result }: { hostId: string; result: Result }) {
  const open = useCallback(() => {
    switch (result.kind) {
      case "chat":
        navigateToAgent({
          serverId: hostId,
          agentId: result.agentId,
          workspaceId: result.workspaceId,
        });
        break;
      case "workflow":
        openWorkflow(result.ref);
        break;
      case "artifact":
        router.push(
          buildPluginSurfaceRoute(
            hostId,
            "otto-artifacts",
            { kind: "surface", id: "artifacts" },
            { artifactRef: JSON.stringify(result.ref) },
          ),
        );
        break;
    }
  }, [result, hostId]);
  return <Button variant="outline" size="sm" onPress={open}>{`Open ${result.kind} result`}</Button>;
}
