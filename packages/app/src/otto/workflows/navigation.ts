import { router } from "expo-router";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { rememberPluginContributionHost, pluginScreensHostKey } from "@/plugins/contribution-host";
import type { WorkflowRef } from "@getpaseo/plugin/otto/workflows";
/** Reuse the existing plugin screen route; no new app route or workspace-selection policy. */
export function openWorkflow(ref: WorkflowRef) {
  rememberPluginContributionHost(pluginScreensHostKey("otto-workflows"), ref.scope.hostId);
  router.push(
    buildPluginSurfaceRoute(
      ref.scope.hostId,
      "otto-workflows",
      { kind: "surface", id: "workflows" },
      {
        projectId: ref.scope.projectId,
        projectHostId: ref.scope.hostId,
        runId: ref.id,
        location: ref.location,
        ...(ref.storeKey ? { storeKey: ref.storeKey } : {}),
      },
    ),
  );
}
