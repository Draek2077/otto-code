import path from "node:path";
import { z } from "zod";
import { WorkflowRef } from "@getpaseo/plugin/otto/workflows";
import {
  publishWorkflowFile,
  readWorkflowFile,
  workflowDirectory,
  workflowDigest,
} from "./files.js";

export const ActiveWorkflowRecord = z.object({
  ref: WorkflowRef,
  ownerInstance: z.string(),
  agentIds: z.array(z.string()).max(41),
});
export type ActiveWorkflowRecord = z.infer<typeof ActiveWorkflowRecord>;
const schema = z.object({ version: z.literal(1), runs: z.array(ActiveWorkflowRecord).max(2) });

/** Small active-only recovery index. Initialization never scans history or resumes a provider. */
export class WorkflowJournal {
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly home: string) {}
  async read(): Promise<ActiveWorkflowRecord[]> {
    await workflowDirectory(this.home, this.home);
    const bytes = await readWorkflowFile(path.join(this.home, "workflow-active.json"), 64000);
    return bytes === null ? [] : schema.parse(JSON.parse(bytes)).runs;
  }
  update(id: string, value: ActiveWorkflowRecord | null): Promise<void> {
    const next = this.tail.then(async () => {
      const file = path.join(this.home, "workflow-active.json");
      const bytes = await readWorkflowFile(file, 64000);
      const state = schema.parse(bytes === null ? { version: 1, runs: [] } : JSON.parse(bytes));
      const runs = state.runs.filter((run) => run.ref.id !== id);
      if (value) runs.push(value);
      const checked = schema.parse({ version: 1, runs });
      await publishWorkflowFile(
        file,
        JSON.stringify(checked, null, 2) + "\n",
        bytes === null ? null : workflowDigest(bytes),
      );
      return undefined;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  async drain() {
    await this.tail;
  }
}
