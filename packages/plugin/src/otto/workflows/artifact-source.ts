import { z } from "zod";
import { ArtifactRef } from "../artifacts.js";
import { WorkflowRef, workflowRpc } from "./runtime.js";
/** New RPC preserves the older Artifacts source response vocabulary unchanged. */
export const workflowArtifactSource = workflowRpc({
  name: "workflows.artifact.source.read.request",
  input: ArtifactRef,
  output: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unavailable"), message: z.string() }),
    z.object({
      kind: z.literal("workflow"),
      ref: WorkflowRef,
      title: z.string(),
      status: z.string(),
      workspaceId: z.string().nullable(),
      conductorAgentId: z.string().nullable(),
      summary: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ]),
});
export type WorkflowArtifactSource = z.infer<typeof workflowArtifactSource.output>;
