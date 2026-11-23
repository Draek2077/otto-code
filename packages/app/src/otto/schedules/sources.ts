import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input, output } from "zod";
import {
  workflowList,
  workflowRead,
  normalizeWorkflowEntry,
} from "@getpaseo/plugin/otto/workflows";
import { listArtifacts } from "@getpaseo/plugin/otto/artifacts";
import type { ScheduleRpcTransport } from "./api";

/** Read existing libraries through their owning authenticated APIs. No scheduler-owned
 * copy of Workflow definitions or Artifact documents and no launch during selection. */
export function createScheduleSources(transport: ScheduleRpcTransport) {
  async function call<I extends ZodType, O extends ZodType>(
    plugin: string,
    contract: PluginRpcContract<I, O>,
    value: input<I>,
  ): Promise<output<O>> {
    const result = await transport.invokePluginRpc(
      plugin,
      contract.name,
      contract.input.parse(value),
    );
    return contract.output.parse(result);
  }
  return {
    async workflows(value: input<typeof workflowList.input>) {
      const response = await call("otto-workflows", workflowList, value);
      if (!response.ok) throw new Error(response.error.message);
      return response.value;
    },
    async workflow(value: input<typeof workflowRead.input>) {
      const response = await call("otto-workflows", workflowRead, value);
      if (!response.ok) throw new Error(response.error.message);
      return normalizeWorkflowEntry(response.value);
    },
    async artifacts(value: input<typeof listArtifacts.input>) {
      const response = await call("otto-artifacts", listArtifacts, value);
      if (!response.ok) throw new Error(response.error.message);
      return response.value;
    },
  };
}
export type ScheduleSources = ReturnType<typeof createScheduleSources>;
