/** Terminal reads and actions stay bound to the selected daemon connection and owner lifetime. */
import { z } from "zod";
import { BrainConnectionError, type BrainController } from "@getpaseo/brain/host";
import {
  BrainTuiSnapshotSchema,
  BrainTuiJobsSchema,
  BrainTuiResourcesSchema,
  performTuiAction,
  BrainTuiActionSchema,
  TuiActionError,
} from "@getpaseo/brain/tui";
import type { BrainStatus } from "@getpaseo/protocol/otto/brain";
import type { BrainRequestLeases } from "./request-leases.js";
const Revision = z.string().min(1).max(1024);
const Read = z
  .object({
    connectionRevision: Revision,
    requestId: z.string().uuid(),
    resource: z.enum(["snapshot", "jobs", "resources"]),
  })
  .strict();
const Action = z
  .object({ connectionRevision: Revision, instanceId: Revision, action: z.unknown() })
  .strict();
const Start = z.object({ connectionRevision: Revision }).strict();
const Resources = {
  snapshot: { route: "/__host/tui", schema: BrainTuiSnapshotSchema },
  jobs: { route: "/__host/tui/jobs", schema: BrainTuiJobsSchema },
  resources: { route: "/__host/tui/resources", schema: BrainTuiResourcesSchema },
};
export class BrainDaemonTui {
  constructor(
    private readonly controller: BrainController<BrainStatus>,
    private readonly reads: BrainRequestLeases,
    private readonly localRunning: () => boolean,
  ) {}
  async invoke(method: string, input: unknown, clientId: string): Promise<unknown> {
    if (method === "brain.tui.start") {
      const origin = Start.parse(input);
      const connection = this.controller.readConnection();
      if (connection.revision !== origin.connectionRevision || connection.config.mode !== "local")
        throw new BrainConnectionError(
          "conflict",
          "Reopen the terminal on the intended local Brain owner.",
        );
      if (!this.localRunning()) await this.controller.startManagementOwner();
      return { accepted: true };
    }
    if (method === "brain.tui.read") {
      const read = Read.parse(input);
      const resource = Resources[read.resource];
      return this.reads.run(clientId, read.requestId, (signal) =>
        this.controller.withOwner(
          read,
          async (request) => {
            const value = resource.schema.safeParse(await request(resource.route));
            if (!value.success)
              throw new BrainConnectionError(
                "unknown",
                "Update the Brain owner to read its terminal data.",
              );
            return value.data;
          },
          signal,
        ),
      );
    }
    const inputAction = Action.parse(input);
    const action = BrainTuiActionSchema.safeParse(inputAction.action);
    if (!action.success)
      throw new BrainConnectionError("validation", "Check the Brain terminal operation fields.");
    try {
      return await this.controller.withOwner(inputAction, (request) =>
        performTuiAction(action.data, request),
      );
    } catch (error) {
      if (error instanceof TuiActionError)
        throw new BrainConnectionError(
          error.status === "conflict" ? "conflict" : "validation",
          error.message,
        );
      throw error;
    }
  }
}
