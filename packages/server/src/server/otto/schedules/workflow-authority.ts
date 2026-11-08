import type { WorkflowLaunch } from "@getpaseo/plugin/otto/workflows";
import type { ScheduleTarget } from "./types.js";
import { canonicalJson } from "../workflows/graph-identity.js";
import { scheduleDigest } from "./files.js";
type Target = Extract<ScheduleTarget, { type: "workflow" }>;
const documentContent = new Set([
  "title",
  "name",
  "description",
  "prompt",
  "createdAt",
  "updatedAt",
  "workflowStorage",
]);
const nodeContent = new Set(["title", "prompt", "position"]);
const inputContent = new Set(["label", "description", "defaultValue"]);
function without(value: Readonly<Record<string, unknown>>, keys: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}
/** Separate from the exact content revision stamped at fire time: payload/display edits may refresh
 * on the next fire, while seats, topology, access, limits and executable-template revisions need review.
 * Unknown non-content fields remain significant, so a future authority field cannot silently disappear. */
export function workflowScheduleAuthority(target: Target, launch: WorkflowLaunch): string {
  const definition =
    launch.kind === "ai"
      ? without(launch.definition, documentContent)
      : {
          ...without(launch.graph, documentContent),
          nodes: launch.graph.nodes.map((node) => without(node, nodeContent)),
          inputs: launch.graph.inputs?.map((input) => without(input, inputContent)),
        };
  const templates =
    launch.kind === "graph"
      ? launch.templateSnapshots?.map((snapshot) => ({
          ref: snapshot.ref,
          ...(launch.allowTemplateCode ? { revision: snapshot.revision } : {}),
        }))
      : undefined;
  return scheduleDigest(
    JSON.stringify(
      canonicalJson({
        version: 1,
        source: target.source,
        workspaceId: target.workspaceId,
        seats: target.seats,
        limits: target.limits,
        inputs: target.inputs,
        allowTemplateCode: target.approval.allowTemplateCode,
        allowQueryEffects: target.approval.allowQueryEffects,
        kind: launch.kind,
        definition,
        templates,
      }),
    ),
  );
}
