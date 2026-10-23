import type { Profile } from "../config/schema.js";
import type { Supervisor } from "../service/supervisor.js";

export type OperationSupervisor = Pick<
  Supervisor,
  | "host"
  | "internalPort"
  | "logVerbosity"
  | "allocationLogLines"
  | "vramAtReadyBytes"
  | "vramBaselineBytes"
  | "loadSeconds"
>;

/** The scheduler supplies this lease; an operation never creates a sidecar. */
export interface ModelOperationProcess {
  supervisor: OperationSupervisor;
  start(profile: Profile): Promise<void>;
  stop(): Promise<void>;
}
