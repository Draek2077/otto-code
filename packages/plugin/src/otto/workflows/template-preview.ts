import { z } from "zod";
import { PromptTemplateSchema } from "./model.js";
import { WorkflowScope, workflowRpc } from "./runtime.js";
export const workflowPreviewTemplate = workflowRpc({
  name: "workflows.template.preview.request",
  input: z.object({
    scope: WorkflowScope,
    template: PromptTemplateSchema,
    variables: z.record(z.string(), z.unknown()),
    allowCode: z.boolean().optional(),
  }),
  output: z.object({ text: z.string() }),
});
